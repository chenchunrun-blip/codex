import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { computeTaskRisk } from "@/lib/tasks/risk"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { AssigneeType, TaskStatus } from "@prisma/client"

export type ProjectBottlenecksData = {
  queueBacklog: Array<{ domain: string; backlog: number; onlineAgents: number }>
  atRiskDomains: Array<{ domain: string; backlog: number; onlineAgents: number }>
  highRiskTasks: Array<{
    id: string
    title: string
    status: TaskStatus
    riskScore: number
    riskLevel: "LOW" | "MEDIUM" | "HIGH"
    riskReasons: string[]
  }>
  recommendations: Array<{ type: "QUEUE" | "TASK"; title: string; action: string }>
}

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function buildRecommendations(input: {
  atRiskDomains: Array<{ domain: string; backlog: number; onlineAgents: number }>
  highRiskTasks: Array<{ id: string; title: string; riskScore: number; riskReasons: string[] }>
}) {
  const items: Array<{ type: "QUEUE" | "TASK"; title: string; action: string }> = []

  for (const domain of input.atRiskDomains.slice(0, 3)) {
    items.push({
      type: "QUEUE",
      title: `Queue domain ${domain.domain} has backlog ${domain.backlog} with no online agents`,
      action: `Bring at least one ${domain.domain} agent online or disable online-only dispatch for emergency handling`
    })
  }

  for (const task of input.highRiskTasks.slice(0, 5)) {
    const reason = task.riskReasons[0] || "High combined risk score"
    items.push({
      type: "TASK",
      title: `${task.title} (${task.id}) is high risk (${task.riskScore})`,
      action: `Prioritize immediate triage: ${reason}`
    })
  }

  if (items.length === 0) {
    items.push({
      type: "TASK",
      title: "No critical bottlenecks detected",
      action: "Maintain current dispatch policy and continue monitoring every 30 minutes"
    })
  }
  return items
}

export async function resolveProjectBottlenecks(projectId: string): Promise<ProjectBottlenecksData> {
  const [queueRows, agents, tasks] = await Promise.all([
    db.task.groupBy({
      by: ["functionalAgentType"],
      where: {
        projectId,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
      },
      _count: { _all: true }
    }),
    db.agent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        capabilities: true,
        updatedAt: true
      }
    }),
    db.task.findMany({
      where: {
        projectId,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] }
      },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        assigneeType: true,
        functionalAgentType: true,
        specMarkdown: true
      },
      orderBy: { createdAt: "desc" },
      take: 200
    })
  ])

  const onlineAgentsByDomain = new Map<string, number>()
  for (const agent of agents) {
    if (!isAgentOnline(agent.updatedAt) || !Array.isArray(agent.capabilities)) continue
    for (const capability of agent.capabilities) {
      if (typeof capability !== "string") continue
      const key = capability.trim().toUpperCase()
      if (!key) continue
      onlineAgentsByDomain.set(key, (onlineAgentsByDomain.get(key) || 0) + 1)
    }
  }

  const queueBacklog = queueRows.map((row) => ({
    domain: row.functionalAgentType || "UNSPECIFIED",
    backlog: row._count._all,
    onlineAgents: row.functionalAgentType
      ? onlineAgentsByDomain.get(row.functionalAgentType.toUpperCase()) || 0
      : 0
  }))
  const atRiskDomains = queueBacklog.filter((item) => item.backlog > 0 && item.onlineAgents === 0)

  const taskIds = tasks.map((task) => task.id)
  const runLogs = taskIds.length
    ? await db.activityLog.findMany({
        where: {
          projectId,
          taskId: { in: taskIds }
        },
        orderBy: { createdAt: "desc" },
        select: {
          taskId: true,
          createdAt: true,
          metadata: true
        }
      })
    : []
  const latestRunStatusByTask = new Map<string, "SUCCESS" | "FAILED">()
  for (const log of runLogs) {
    if (!log.taskId || latestRunStatusByTask.has(log.taskId)) continue
    const type = metadataType(log.metadata)
    if (type === "AGENT_RUN_FAILED") latestRunStatusByTask.set(log.taskId, "FAILED")
    if (type === "AGENT_RUN_TRIGGERED") latestRunStatusByTask.set(log.taskId, "SUCCESS")
  }

  const highRiskTasks = tasks
    .map((task) => {
      const specQualityScore = task.specMarkdown ? lintTaskSpecMarkdown(task.specMarkdown).score : null
      const risk = computeTaskRisk({
        dueDate: task.dueDate,
        latestAgentRunStatus: latestRunStatusByTask.get(task.id) || null,
        specQualityScore,
        assigneeType: task.assigneeType,
        functionalAgentType: task.functionalAgentType,
        status: task.status,
        onlineAgentsByDomain
      })
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        riskReasons: risk.riskReasons
      }
    })
    .filter((task) => task.riskLevel === "HIGH")
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 20)

  const recommendations = buildRecommendations({
    atRiskDomains,
    highRiskTasks: highRiskTasks.map((task) => ({
      id: task.id,
      title: task.title,
      riskScore: task.riskScore,
      riskReasons: task.riskReasons
    }))
  })

  return {
    queueBacklog,
    atRiskDomains,
    highRiskTasks,
    recommendations
  }
}

export function buildProjectBottlenecksMarkdown(input: {
  projectId: string
  generatedAt: string
  data: ProjectBottlenecksData
}) {
  return `# Project Bottlenecks Report

- Project ID: ${input.projectId}
- Generated At: ${input.generatedAt}

## At-Risk Queue Domains
${input.data.atRiskDomains.length > 0
  ? input.data.atRiskDomains
      .map((item) => `- ${item.domain}: backlog=${item.backlog}, onlineAgents=${item.onlineAgents}`)
      .join("\n")
  : "- None"}

## High-Risk Tasks
${input.data.highRiskTasks.length > 0
  ? input.data.highRiskTasks
      .map((task) => `- ${task.title} (${task.id}) | score=${task.riskScore} | ${task.riskReasons.join("; ")}`)
      .join("\n")
  : "- None"}

## Recommendations
${input.data.recommendations.map((item) => `- [${item.type}] ${item.title}. Action: ${item.action}`).join("\n")}
`
}
