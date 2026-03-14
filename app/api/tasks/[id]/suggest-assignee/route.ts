import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { resolveProjectDispatchPolicy } from "@/lib/tasks/dispatch-policy"
import { taskSuggestAssigneeSchema } from "@/lib/utils/validation"
import { AssigneeType, FunctionalAgentType, TaskAssignmentAction, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"
import { ZodError } from "zod"

type Weights = {
  agentDomainMatch: number
  workload: number
  deadlineRisk: number
}

type RawWeights = {
  functionalMatch?: number
  agentDomainMatch?: number
  workload?: number
  deadlineRisk?: number
}

type Suggestion = {
  rank: number
  assigneeType: "HUMAN" | "FUNCTIONAL_AGENT"
  assigneeId?: string
  agentId?: string
  agentOnline?: boolean
  functionalAgentType?: FunctionalAgentType
  score: number
  reasons: string[]
}

const DEFAULT_WEIGHTS: Weights = {
  agentDomainMatch: 0.5,
  workload: 0.3,
  deadlineRisk: 0.2
}

function normalizeWeights(input?: RawWeights): Weights {
  if (!input) return DEFAULT_WEIGHTS
  const merged: Weights = {
    agentDomainMatch: input.agentDomainMatch ?? input.functionalMatch ?? DEFAULT_WEIGHTS.agentDomainMatch,
    workload: input.workload ?? DEFAULT_WEIGHTS.workload,
    deadlineRisk: input.deadlineRisk ?? DEFAULT_WEIGHTS.deadlineRisk
  }
  const sum = merged.agentDomainMatch + merged.workload + merged.deadlineRisk
  if (sum <= 0) return DEFAULT_WEIGHTS
  return {
    agentDomainMatch: merged.agentDomainMatch / sum,
    workload: merged.workload / sum,
    deadlineRisk: merged.deadlineRisk / sum
  }
}

function inferAgentDomainType(raw: string): FunctionalAgentType {
  const text = raw.toLowerCase()
  if (/test|qa|quality|验收|测试/.test(text)) return FunctionalAgentType.QA
  if (/design|ui|ux|界面|设计/.test(text)) return FunctionalAgentType.DESIGN
  if (/operate|ops|运营|发布|deployment/.test(text)) return FunctionalAgentType.OPERATIONS
  if (/product|需求|roadmap|规划/.test(text)) return FunctionalAgentType.PRODUCT
  return FunctionalAgentType.ENGINEERING
}

function deadlineRiskScore(dueDate: Date | null, workloadScore: number): number {
  if (!dueDate) return 0.8
  const msLeft = dueDate.getTime() - Date.now()
  const daysLeft = msLeft / (1000 * 60 * 60 * 24)
  if (daysLeft <= 1) return Math.max(0.1, workloadScore - 0.3)
  if (daysLeft <= 3) return Math.max(0.2, workloadScore - 0.1)
  return Math.min(1, workloadScore + 0.1)
}

function finalScore(agentDomain: number, workload: number, deadline: number, weights: Weights): number {
  return (
    agentDomain * weights.agentDomainMatch +
    workload * weights.workload +
    deadline * weights.deadlineRisk
  )
}

/**
 * POST /api/tasks/[id]/suggest-assignee - Suggest top-N assignees
 * Requires: project membership
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const validated = taskSuggestAssigneeSchema.parse(body)
    const weights = normalizeWeights(validated.weights)

    const task = await db.task.findUnique({
      where: { id }
    })

    if (!task) {
      return NextResponse.json(
        { error: "Task not found", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: task.projectId,
          userId: session.user!.id
        }
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const inferredAgentDomainType =
      task.functionalAgentType ??
      inferAgentDomainType(`${task.title}\n${task.description ?? ""}\n${task.specMarkdown ?? ""}`)
    const dispatchPolicy = await resolveProjectDispatchPolicy(task.projectId)

    const members = await db.projectMember.findMany({
      where: { projectId: task.projectId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    const memberUserIds = members.map((m) => m.userId)
    const inProgressByUser = await db.task.groupBy({
      by: ["assigneeId"],
      where: {
        assigneeId: { in: memberUserIds },
        status: TaskStatus.IN_PROGRESS
      },
      _count: true
    })

    const inProgressUserMap = new Map<string, number>()
    for (const row of inProgressByUser) {
      if (row.assigneeId) inProgressUserMap.set(row.assigneeId, row._count)
    }

    const historicalByUser = await db.task.groupBy({
      by: ["assigneeId"],
      where: {
        assigneeId: { in: memberUserIds },
        status: TaskStatus.COMPLETED,
        functionalAgentType: inferredAgentDomainType
      },
      _count: true
    })

    const historyUserMap = new Map<string, number>()
    for (const row of historicalByUser) {
      if (row.assigneeId) historyUserMap.set(row.assigneeId, row._count)
    }

    const humanSuggestions: Suggestion[] = members.map((member) => {
      const workloadCount = inProgressUserMap.get(member.userId) ?? 0
      const workloadScore = Math.max(0, 1 - workloadCount / 5)
      const historyCount = historyUserMap.get(member.userId) ?? 0
      const agentDomainScore = Math.min(1, 0.6 + historyCount * 0.1)
      const deadlineScore = deadlineRiskScore(task.dueDate, workloadScore)
      const score = finalScore(agentDomainScore, workloadScore, deadlineScore, weights)

      return {
        rank: 0,
        assigneeType: "HUMAN",
        assigneeId: member.userId,
        score: Number(score.toFixed(4)),
        reasons: [
          `Agent domain match: ${inferredAgentDomainType}`,
          `Current workload: ${workloadCount} in-progress tasks`
        ]
      }
    })

    const agents = await db.agent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        displayName: true,
        capabilities: true,
        updatedAt: true
      }
    })

    const inProgressByAgent = await db.task.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: agents.map((a) => a.id) },
        status: TaskStatus.IN_PROGRESS
      },
      _count: true
    })

    const inProgressAgentMap = new Map<string, number>()
    for (const row of inProgressByAgent) {
      if (row.agentId) inProgressAgentMap.set(row.agentId, row._count)
    }

    const candidateAgents = dispatchPolicy.onlineOnly
      ? agents.filter((agent) => isAgentOnline(agent.updatedAt))
      : agents

    const agentSuggestions: Suggestion[] = candidateAgents.map((agent) => {
      const workloadCount = inProgressAgentMap.get(agent.id) ?? 0
      const workloadScore = Math.max(0, 1 - workloadCount / 8)
      const capabilityText = JSON.stringify(agent.capabilities ?? "").toLowerCase()
      const agentDomainScore =
        capabilityText.includes(inferredAgentDomainType.toLowerCase()) ? 0.9 : 0.65
      const online = isAgentOnline(agent.updatedAt)
      const deadlineScore = deadlineRiskScore(task.dueDate, workloadScore)
      const baseScore = finalScore(agentDomainScore, workloadScore, deadlineScore, weights)
      const score = online ? Math.min(1, baseScore + 0.05) : Math.max(0, baseScore - 0.05)

      return {
        rank: 0,
        assigneeType: "FUNCTIONAL_AGENT",
        agentId: agent.id,
        agentOnline: online,
        functionalAgentType: inferredAgentDomainType,
        score: Number(score.toFixed(4)),
        reasons: [
          `Agent domain match: ${inferredAgentDomainType}`,
          `Agent workload: ${workloadCount} in-progress tasks`,
          `Agent status: ${online ? "online" : "idle"}`,
          `Dispatch policy: ${dispatchPolicy.onlineOnly ? "online-only" : "all-active"}`
        ]
      }
    })

    const suggestions = [...humanSuggestions, ...agentSuggestions]
      .sort((a, b) => b.score - a.score)
      .slice(0, validated.topN)
      .map((item, index) => ({ ...item, rank: index + 1 }))

    await db.taskAssignmentLog.create({
      data: {
        taskId: task.id,
        action: TaskAssignmentAction.SUGGESTED,
        actorUserId: session.user!.id,
        toType:
          suggestions[0]?.assigneeType === "HUMAN"
            ? AssigneeType.HUMAN
            : AssigneeType.FUNCTIONAL_AGENT,
        toAssigneeId: suggestions[0]?.assigneeId ?? null,
        toAgentId: suggestions[0]?.agentId ?? null,
        metadata: {
          topN: validated.topN,
          weights,
          inferredAgentDomainType,
          suggestions
        }
      }
    })

    return NextResponse.json({
      taskId: task.id,
      suggestions,
      dispatchPolicy: {
        onlineOnly: dispatchPolicy.onlineOnly
      }
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Suggest assignee error:", error)
    return NextResponse.json(
      { error: "Failed to suggest assignee", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
