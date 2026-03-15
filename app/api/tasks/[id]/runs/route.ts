import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

type RunStatus = "SUCCESS" | "FAILED"

type AgentRunItem = {
  executionId: string
  status: RunStatus
  triggeredAt: string
  triggeredByUserId: string | null
  targetAgent: string | null
  runtimeMode: string | null
  deliverableId: string | null
  error: string | null
  idempotencyKey: string | null
}

type AgentRunResponseItem = {
  executionId: string
  status: RunStatus
  triggeredAt: string
  triggeredBy: {
    id: string
    name: string | null
    email: string | null
  } | null
  targetAgent: string | null
  runtimeMode: string | null
  deliverableId: string | null
  error: string | null
  idempotencyKey: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function getString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * GET /api/tasks/[id]/runs - Return normalized agent run history for a task
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const rawLimit = Number(searchParams.get("limit") || "20")
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
      : 20

    const task = await db.task.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true
      }
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

    const logs = await db.activityLog.findMany({
      where: {
        taskId: task.id
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        metadata: true
      }
    })

    const runsByExecution = new Map<string, AgentRunItem>()
    const orderedRuns: AgentRunItem[] = []

    for (const log of logs) {
      const metadata = asRecord(log.metadata)
      if (!metadata) continue

      const type = getString(metadata, "type")
      if (type !== "AGENT_RUN_TRIGGERED" && type !== "AGENT_RUN_FAILED") continue

      const executionId = getString(metadata, "executionId")
      if (!executionId) continue

      const existing = runsByExecution.get(executionId)
      const status: RunStatus = type === "AGENT_RUN_FAILED" ? "FAILED" : "SUCCESS"
      const candidate: AgentRunItem = {
        executionId,
        status,
        triggeredAt: log.createdAt.toISOString(),
        triggeredByUserId: log.userId || null,
        targetAgent: getString(metadata, "targetAgent"),
        runtimeMode: getString(metadata, "runtimeMode"),
        deliverableId: getString(metadata, "deliverableId"),
        error: getString(metadata, "error"),
        idempotencyKey: getString(metadata, "idempotencyKey")
      }

      if (!existing) {
        runsByExecution.set(executionId, candidate)
        orderedRuns.push(candidate)
        continue
      }

      if (existing.status === "SUCCESS" && candidate.status === "FAILED") {
        existing.status = "FAILED"
      }
      if (!existing.error && candidate.error) existing.error = candidate.error
      if (!existing.targetAgent && candidate.targetAgent) existing.targetAgent = candidate.targetAgent
      if (!existing.runtimeMode && candidate.runtimeMode) existing.runtimeMode = candidate.runtimeMode
      if (!existing.deliverableId && candidate.deliverableId) existing.deliverableId = candidate.deliverableId
      if (!existing.idempotencyKey && candidate.idempotencyKey) existing.idempotencyKey = candidate.idempotencyKey
      if (!existing.triggeredByUserId && candidate.triggeredByUserId) existing.triggeredByUserId = candidate.triggeredByUserId
    }

    const runs = orderedRuns
      .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
      .slice(0, limit)

    const userIds = Array.from(
      new Set(
        runs
          .map((item) => item.triggeredByUserId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    )
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true }
        })
      : []
    const userMap = new Map(users.map((user) => [user.id, user]))
    const runsWithActor: AgentRunResponseItem[] = runs.map((item) => ({
      executionId: item.executionId,
      status: item.status,
      triggeredAt: item.triggeredAt,
      triggeredBy: item.triggeredByUserId
        ? userMap.get(item.triggeredByUserId) || { id: item.triggeredByUserId, name: null, email: null }
        : null,
      targetAgent: item.targetAgent,
      runtimeMode: item.runtimeMode,
      deliverableId: item.deliverableId,
      error: item.error,
      idempotencyKey: item.idempotencyKey
    }))

    return NextResponse.json({
      taskId: task.id,
      runs: runsWithActor,
      total: runsWithActor.length
    })
  } catch (error) {
    console.error("Task runs fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch task runs", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
