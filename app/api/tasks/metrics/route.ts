import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { resolveProjectDispatchPolicy } from "@/lib/tasks/dispatch-policy"
import {
  AVAILABLE_RETRYABLE_ERROR_CODES,
  DEFAULT_RETRYABLE_ERROR_CODES,
  resolveProjectRetryableCodes
} from "@/lib/tasks/retryable-codes"
import { ActionType, AssigneeType, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"

const MAX_ACTIVITY_LOG_SCAN = 1200

function logCompatibilityFallback(message: string, error: unknown) {
  if (process.env.NODE_ENV === "test") return
  console.warn(message, error)
}

function toReasonLabel(value: unknown): string {
  if (typeof value !== "string") return "Unknown runtime failure"
  const trimmed = value.trim()
  if (!trimmed) return "Unknown runtime failure"
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 77)}...`
}

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function getMetadataError(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const error = (metadata as { error?: unknown }).error
  return typeof error === "string" ? error : null
}

function emptyPayload(input: {
  projectId: string | null
  days: number
  degraded?: boolean
}) {
  return {
    scope: { projectId: input.projectId, days: input.days },
    degraded: input.degraded === true,
    retryableErrorCodes: DEFAULT_RETRYABLE_ERROR_CODES,
    availableRetryableErrorCodes: AVAILABLE_RETRYABLE_ERROR_CODES,
    retryConfigUpdatedAt: null,
    retryConfigSource: "default",
    dispatchPolicyOnlineOnly: null,
    dispatchPolicySource: "mixed",
    backlog: { total: 0, byQueueDomain: [] },
    execution: {
      runs: 0,
      success: 0,
      failed: 0,
      successRate: 0
    },
    completion: {
      completedTasks: 0,
      avgCompletionHours: null
    },
    risk: {
      overdue: 0,
      dueIn24h: 0,
      dueIn3d: 0,
      total: 0
    },
    failures: [],
    dispatchHistory: []
  }
}

async function loadBacklogSummary(
  projectIds: string[]
): Promise<{ total: number; byQueueDomain: Array<{ domain: string; count: number }> }> {
  try {
    const rows = await db.task.groupBy({
      by: ["functionalAgentType"],
      where: {
        projectId: { in: projectIds },
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT
      },
      _count: {
        _all: true
      }
    })
    const byQueueDomain = rows
      .map((row) => ({
        domain: row.functionalAgentType || "UNSPECIFIED",
        count: row._count?._all || 0
      }))
      .sort((a, b) => b.count - a.count)
    const total = byQueueDomain.reduce((sum, row) => sum + row.count, 0)
    return { total, byQueueDomain }
  } catch (error) {
    logCompatibilityFallback("Task metrics backlog groupBy fallback:", error)
  }

  let backlogTasks: Array<{ functionalAgentType: string | null }> = []
  try {
    backlogTasks = await db.task.findMany({
      where: {
        projectId: { in: projectIds },
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT
      },
      select: {
        functionalAgentType: true
      }
    })
  } catch (error) {
    logCompatibilityFallback("Task metrics backlog query fallback #1:", error)
  }

  try {
    backlogTasks = await db.task.findMany({
      where: {
        projectId: { in: projectIds },
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.AGENT
      },
      select: {
        functionalAgentType: true
      }
    })
  } catch (error) {
    logCompatibilityFallback("Task metrics backlog query fallback #2:", error)
  }

  try {
    const legacyRows = await db.task.findMany({
      where: {
        projectId: { in: projectIds },
        status: TaskStatus.PENDING
      },
      select: {
        id: true
      }
    })
    backlogTasks = legacyRows.map(() => ({ functionalAgentType: "LEGACY" }))
  } catch (error) {
    logCompatibilityFallback("Task metrics backlog query fallback #3:", error)
    backlogTasks = []
  }

  const backlogMap = new Map<string, number>()
  for (const task of backlogTasks) {
    const key = task.functionalAgentType || "UNSPECIFIED"
    backlogMap.set(key, (backlogMap.get(key) || 0) + 1)
  }
  const byQueueDomain = Array.from(backlogMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)

  return { total: backlogTasks.length, byQueueDomain }
}

async function loadCompletedTasks(
  projectIds: string[],
  since: Date
): Promise<Array<{ startedAt: Date | null; completedAt: Date | null }>> {
  try {
    return await db.task.findMany({
      where: {
        projectId: { in: projectIds },
        completedAt: { gte: since },
        assigneeType: { not: AssigneeType.HUMAN },
        startedAt: { not: null }
      },
      select: {
        startedAt: true,
        completedAt: true
      }
    })
  } catch (error) {
    logCompatibilityFallback("Task metrics completed query fallback:", error)
    return await db.task.findMany({
      where: {
        projectId: { in: projectIds },
        completedAt: { gte: since },
        startedAt: { not: null }
      },
      select: {
        startedAt: true,
        completedAt: true
      }
    })
  }
}

async function loadRiskCounts(projectIds: string[]): Promise<{
  overdue: number
  dueIn24h: number
  dueIn3d: number
}> {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in3d = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  try {
    const [overdueRaw, dueIn24hRaw, dueIn3dRaw] = await Promise.all([
      db.task.count({
        where: {
          projectId: { in: projectIds },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
          dueDate: { lt: now }
        }
      }),
      db.task.count({
        where: {
          projectId: { in: projectIds },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
          dueDate: { gte: now, lte: in24h }
        }
      }),
      db.task.count({
        where: {
          projectId: { in: projectIds },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
          dueDate: { gt: in24h, lte: in3d }
        }
      })
    ])
    return {
      overdue: Number(overdueRaw) || 0,
      dueIn24h: Number(dueIn24hRaw) || 0,
      dueIn3d: Number(dueIn3dRaw) || 0
    }
  } catch (error) {
    logCompatibilityFallback("Task metrics risk count fallback:", error)
  }

  const highRiskDueTasks = await db.task.findMany({
    where: {
      projectId: { in: projectIds },
      status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
      dueDate: { not: null }
    },
    select: {
      dueDate: true
    }
  })

  const nowMs = Date.now()
  let overdue = 0
  let dueIn24h = 0
  let dueIn3d = 0
  for (const task of highRiskDueTasks) {
    if (!task.dueDate) continue
    const delta = task.dueDate.getTime() - nowMs
    if (delta < 0) {
      overdue += 1
    } else if (delta <= 24 * 60 * 60 * 1000) {
      dueIn24h += 1
    } else if (delta <= 3 * 24 * 60 * 60 * 1000) {
      dueIn3d += 1
    }
  }
  return { overdue, dueIn24h, dueIn3d }
}

/**
 * GET /api/tasks/metrics
 * Query params:
 * - projectId?: string
 * - days?: number (default 14, max 90)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get("projectId")
  const daysRaw = Number(searchParams.get("days") || 14)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 90) : 14

  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    let projectIds: string[] = []
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
      projectIds = [projectId]
    } else {
      const memberships = await db.projectMember.findMany({
        where: { userId: session.user.id },
        select: { projectId: true }
      })
      projectIds = memberships.map((item) => item.projectId)
    }

    if (projectIds.length === 0) {
      return NextResponse.json(
        emptyPayload({
          projectId: projectId || null,
          days
        })
      )
    }

    const [backlogSummary, completedTasks, logs, batchLogs, riskCounts] = await Promise.all([
      loadBacklogSummary(projectIds),
      loadCompletedTasks(projectIds, since),
      db.activityLog.findMany({
        where: {
          projectId: { in: projectIds },
          createdAt: { gte: since },
          action: ActionType.TASK_UPDATED
        },
        orderBy: { createdAt: "desc" },
        take: MAX_ACTIVITY_LOG_SCAN + 1,
        select: {
          metadata: true
        }
      })
      ,
      db.activityLog.findMany({
        where: {
          projectId: { in: projectIds },
          taskId: null,
          action: ActionType.TASK_UPDATED,
          createdAt: { gte: since }
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          createdAt: true,
          metadata: true
        }
      }),
      loadRiskCounts(projectIds)
    ])

    const retryConfig = projectId
      ? await resolveProjectRetryableCodes(projectId)
      : {
          retryableErrorCodes: [...DEFAULT_RETRYABLE_ERROR_CODES],
          updatedAt: null,
          source: "default" as const
        }
    const dispatchPolicy = projectId
      ? await resolveProjectDispatchPolicy(projectId)
      : {
          onlineOnly: null as boolean | null,
          source: "mixed" as const
        }

    const logsTruncated = logs.length > MAX_ACTIVITY_LOG_SCAN
    const normalizedLogs = logsTruncated ? logs.slice(0, MAX_ACTIVITY_LOG_SCAN) : logs

    let runs = 0
    let failed = 0
    const failureMap = new Map<string, number>()

    for (const log of normalizedLogs) {
      const type = getMetadataType(log.metadata)
      if (type === "AGENT_RUN_TRIGGERED" || type === "AGENT_AUTO_DISPATCHED") {
        runs += 1
      }
      if (type === "AGENT_RUN_FAILED" || type === "AGENT_AUTO_DISPATCH_FAILED") {
        failed += 1
        const reason = toReasonLabel(getMetadataError(log.metadata))
        failureMap.set(reason, (failureMap.get(reason) || 0) + 1)
      }
    }

    const success = Math.max(runs - failed, 0)
    const successRate = runs > 0 ? Number(((success / runs) * 100).toFixed(1)) : 0

    let durationTotalMs = 0
    let durationCount = 0
    for (const task of completedTasks) {
      if (!task.startedAt || !task.completedAt) continue
      durationTotalMs += task.completedAt.getTime() - task.startedAt.getTime()
      durationCount += 1
    }
    const avgCompletionHours =
      durationCount > 0 ? Number((durationTotalMs / durationCount / (1000 * 60 * 60)).toFixed(2)) : null

    const failures = Array.from(failureMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    const dispatchHistory = batchLogs
      .map((log) => {
        const type = getMetadataType(log.metadata)
        if (type !== "AGENT_AUTO_DISPATCH_BATCH_COMPLETED") return null
        if (!log.metadata || typeof log.metadata !== "object") return null
        const metadata = log.metadata as Record<string, unknown>
        const total = typeof metadata.total === "number" ? metadata.total : 0
        const successCount = typeof metadata.successCount === "number" ? metadata.successCount : 0
        const failedCount = typeof metadata.failedCount === "number" ? metadata.failedCount : 0
        const triggerMode = typeof metadata.triggerMode === "string" ? metadata.triggerMode : "UNKNOWN"
        const idempotencyKey =
          typeof metadata.idempotencyKey === "string" ? metadata.idempotencyKey : null
        const batchId = typeof metadata.batchId === "string" ? metadata.batchId : null
        const rawResults = Array.isArray(metadata.results) ? metadata.results : []
        const failedTasks = rawResults
          .map((item) => {
            if (!item || typeof item !== "object") return null
            const result = item as Record<string, unknown>
            if (result.status !== "FAILED") return null
            return {
              taskId: typeof result.taskId === "string" ? result.taskId : "unknown-task",
              error:
                typeof result.error === "string" && result.error.trim()
                  ? result.error
                  : "Unknown error",
              errorCode:
                typeof result.errorCode === "string" && result.errorCode.trim()
                  ? result.errorCode
                  : "UNKNOWN_ERROR"
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .slice(0, 10)

        return {
          createdAt: log.createdAt.toISOString(),
          total,
          successCount,
          failedCount,
          triggerMode,
          batchId,
          idempotencyKey,
          failedTasks
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    return NextResponse.json({
      scope: { projectId: projectId || null, days },
      degraded: logsTruncated,
      retryableErrorCodes: retryConfig.retryableErrorCodes,
      availableRetryableErrorCodes: AVAILABLE_RETRYABLE_ERROR_CODES,
      retryConfigUpdatedAt: retryConfig.updatedAt,
      retryConfigSource: retryConfig.source,
      dispatchPolicyOnlineOnly: dispatchPolicy.onlineOnly,
      dispatchPolicySource: dispatchPolicy.source,
      backlog: {
        total: backlogSummary.total,
        byQueueDomain: backlogSummary.byQueueDomain
      },
      execution: {
        runs,
        success,
        failed,
        successRate
      },
      completion: {
        completedTasks: durationCount,
        avgCompletionHours
      },
      risk: {
        overdue: riskCounts.overdue,
        dueIn24h: riskCounts.dueIn24h,
        dueIn3d: riskCounts.dueIn3d,
        total: riskCounts.overdue + riskCounts.dueIn24h + riskCounts.dueIn3d
      },
      failures,
      dispatchHistory
    })
  } catch (error) {
    console.error("Task metrics error:", error)
    return NextResponse.json(
      {
        ...emptyPayload({
          projectId: projectId || null,
          days,
          degraded: true
        }),
        error: "Failed to fetch task metrics",
        code: "INTERNAL_ERROR"
      },
      { status: 200 }
    )
  }
}
