import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { ActionType, AssigneeType, FunctionalAgentType, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"

const DOMAINS: FunctionalAgentType[] = [
  FunctionalAgentType.PRODUCT,
  FunctionalAgentType.ENGINEERING,
  FunctionalAgentType.QA,
  FunctionalAgentType.DESIGN,
  FunctionalAgentType.OPERATIONS
]

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === "string" ? value : null
}

function toDomainCapabilityList(capabilities: unknown): FunctionalAgentType[] {
  if (!Array.isArray(capabilities)) return []
  const normalized = capabilities
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
  return DOMAINS.filter((domain) => normalized.includes(domain.toLowerCase()))
}

function buildMarkdown(input: {
  projectId: string | null
  generatedAt: string
  summary: {
    totalAgents: number
    activeAgents: number
    onlineAgents: number
    totalActiveTasks: number
    failedRunsInWindow: number
    windowHours: number
  }
  agents: Array<{
    displayName: string | null
    name: string
    isActive: boolean
    isOnline: boolean
    workload: {
      pending: number
      inProgress: number
      review: number
      activeTasks: number
    }
    recentRuns: {
      success: number
      failed: number
      lastRunAt: string | null
      lastRunStatus: "SUCCESS" | "FAILED" | null
    }
    queuePressure: {
      domains: FunctionalAgentType[]
      backlog: number
    }
  }>
}): string {
  const rows =
    input.agents.length === 0
      ? "- No agents found"
      : input.agents
          .map((agent) => {
            const name = agent.displayName || agent.name
            const domains =
              agent.queuePressure.domains.length > 0
                ? agent.queuePressure.domains.join(", ")
                : "N/A"
            const lastRun =
              agent.recentRuns.lastRunAt && agent.recentRuns.lastRunStatus
                ? `${agent.recentRuns.lastRunAt} (${agent.recentRuns.lastRunStatus})`
                : "N/A"
            return `- ${name} | active=${agent.isActive ? "yes" : "no"} | online=${agent.isOnline ? "yes" : "no"} | tasks=${agent.workload.activeTasks} (P:${agent.workload.pending}/IP:${agent.workload.inProgress}/R:${agent.workload.review}) | runs=${agent.recentRuns.success}/${agent.recentRuns.failed} | lastRun=${lastRun} | domains=${domains} | backlog=${agent.queuePressure.backlog}`
          })
          .join("\n")

  return `# Agent Workload Report

- Generated At: ${input.generatedAt}
- Project ID: ${input.projectId || "ALL_ACCESSIBLE"}
- Window (hours): ${input.summary.windowHours}
- Total Agents: ${input.summary.totalAgents}
- Active Agents: ${input.summary.activeAgents}
- Online Agents: ${input.summary.onlineAgents}
- Total Active Tasks: ${input.summary.totalActiveTasks}
- Failed Runs (window): ${input.summary.failedRunsInWindow}

## Agent Details
${rows}
`
}

/**
 * GET /api/agents/workload
 * Query:
 * - projectId (optional)
 * - hours (optional, default=24, min=1, max=168)
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get("projectId")
    const rawHours = Number(searchParams.get("hours") || "24")
    const hours = Number.isFinite(rawHours)
      ? Math.min(Math.max(Math.trunc(rawHours), 1), 168)
      : 24

    if (projectId) {
      const membership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: session.user.id
          }
        }
      })
      if (!membership) {
        return NextResponse.json(
          { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
          { status: 403 }
        )
      }
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const [agents, queueGrouped, tasksForAgents] = await Promise.all([
      db.agent.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          capabilities: true,
          isActive: true,
          updatedAt: true
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }]
      }),
      db.task.groupBy({
        by: ["functionalAgentType"],
        where: {
          ...(projectId ? { projectId } : {}),
          assigneeType: AssigneeType.FUNCTIONAL_AGENT,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
        },
        _count: { _all: true }
      }),
      db.task.findMany({
        where: {
          ...(projectId ? { projectId } : {}),
          agentId: { not: null }
        },
        select: {
          id: true,
          agentId: true,
          status: true
        }
      })
    ])

    const taskIds = tasksForAgents.map((task) => task.id)
    const runLogs = taskIds.length
      ? await db.activityLog.findMany({
          where: {
            ...(projectId ? { projectId } : {}),
            taskId: { in: taskIds },
            action: ActionType.TASK_UPDATED,
            createdAt: { gte: since }
          },
          orderBy: { createdAt: "desc" },
          select: {
            taskId: true,
            createdAt: true,
            metadata: true
          }
        })
      : []

    const queueBacklogMap = new Map<FunctionalAgentType, number>()
    for (const row of queueGrouped) {
      if (!row.functionalAgentType) continue
      queueBacklogMap.set(row.functionalAgentType, row._count._all)
    }

    const tasksByAgent = new Map<string, Array<{ status: TaskStatus; id: string }>>()
    const taskAgentMap = new Map<string, string>()
    for (const task of tasksForAgents) {
      if (!task.agentId) continue
      if (!tasksByAgent.has(task.agentId)) {
        tasksByAgent.set(task.agentId, [])
      }
      tasksByAgent.get(task.agentId)!.push({ status: task.status, id: task.id })
      taskAgentMap.set(task.id, task.agentId)
    }

    const agentIdByName = new Map(
      agents.map((agent) => [agent.name.trim().toLowerCase(), agent.id])
    )
    const runsByAgent = new Map<
      string,
      {
        success: number
        failed: number
        lastRunAt: string | null
        lastRunStatus: "SUCCESS" | "FAILED" | null
      }
    >()
    for (const log of runLogs) {
      const type = metadataType(log.metadata)
      if (type !== "AGENT_RUN_TRIGGERED" && type !== "AGENT_RUN_FAILED") continue

      const resolvedByTask = log.taskId ? taskAgentMap.get(log.taskId) : null
      const targetAgentName = metadataString(log.metadata, "targetAgent")
      const resolvedByName = targetAgentName
        ? agentIdByName.get(targetAgentName.trim().toLowerCase()) || null
        : null
      const agentId = resolvedByTask || resolvedByName
      if (!agentId) continue

      if (!runsByAgent.has(agentId)) {
        runsByAgent.set(agentId, {
          success: 0,
          failed: 0,
          lastRunAt: null,
          lastRunStatus: null
        })
      }
      const stat = runsByAgent.get(agentId)!
      if (type === "AGENT_RUN_FAILED") {
        stat.failed += 1
      } else {
        stat.success += 1
      }
      if (!stat.lastRunAt) {
        stat.lastRunAt = log.createdAt.toISOString()
        stat.lastRunStatus = type === "AGENT_RUN_FAILED" ? "FAILED" : "SUCCESS"
      }
    }

    const agentStats = agents.map((agent) => {
      const assignedTasks = tasksByAgent.get(agent.id) || []
      const pending = assignedTasks.filter((task) => task.status === TaskStatus.PENDING).length
      const inProgress = assignedTasks.filter((task) => task.status === TaskStatus.IN_PROGRESS).length
      const review = assignedTasks.filter((task) => task.status === TaskStatus.REVIEW).length
      const activeTasks = pending + inProgress + review
      const domains = toDomainCapabilityList(agent.capabilities)
      const queuePressure = domains.reduce((sum, domain) => sum + (queueBacklogMap.get(domain) || 0), 0)
      const runs = runsByAgent.get(agent.id) || {
        success: 0,
        failed: 0,
        lastRunAt: null,
        lastRunStatus: null
      }

      return {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        isActive: agent.isActive,
        isOnline: isAgentOnline(agent.updatedAt),
        lastActiveAt: agent.updatedAt.toISOString(),
        workload: {
          pending,
          inProgress,
          review,
          activeTasks
        },
        recentRuns: {
          success: runs.success,
          failed: runs.failed,
          lastRunAt: runs.lastRunAt,
          lastRunStatus: runs.lastRunStatus
        },
        queuePressure: {
          domains,
          backlog: queuePressure
        }
      }
    })

    const summary = {
      totalAgents: agentStats.length,
      activeAgents: agentStats.filter((agent) => agent.isActive).length,
      onlineAgents: agentStats.filter((agent) => agent.isOnline).length,
      totalActiveTasks: agentStats.reduce((sum, agent) => sum + agent.workload.activeTasks, 0),
      failedRunsInWindow: agentStats.reduce((sum, agent) => sum + agent.recentRuns.failed, 0),
      windowHours: hours
    }

    const payload = {
      projectId: projectId || null,
      generatedAt: new Date().toISOString(),
      summary,
      agents: agentStats
    }

    if (searchParams.get("format") === "markdown") {
      return new Response(buildMarkdown(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Agent workload error:", error)
    return NextResponse.json(
      { error: "Failed to fetch agent workload", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
