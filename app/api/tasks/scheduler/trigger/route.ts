import { AgentRuntimeError, executeTaskWithAgent } from "@/lib/agents/runtime"
import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline, pickPreferredAgent } from "@/lib/tasks/agent-selection"
import { resolveProjectDispatchPolicyFromLogs } from "@/lib/tasks/dispatch-policy"
import { resolveProjectSchedulerConfig } from "@/lib/tasks/scheduler-config"
import { resolveProjectSystemActor } from "@/lib/tasks/system-actor"
import { taskAutoDispatchSchema } from "@/lib/utils/validation"
import {
  ActionType,
  AssigneeType,
  AssignmentMode,
  DeliverableStatus,
  FunctionalAgentType,
  ProjectRole,
  TaskStatus
} from "@prisma/client"
import { NextResponse } from "next/server"

const RUN_RATE_LIMIT_PER_HOUR = 5
const DISPATCH_CONFLICT_WINDOW_MS = 60 * 1000
const IDEMPOTENCY_LOOKBACK_MS = 24 * 60 * 60 * 1000

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function getMetadataIdempotencyKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const key = (metadata as { idempotencyKey?: unknown }).idempotencyKey
  return typeof key === "string" ? key : null
}

function getMetadataBatchResult(metadata: unknown): {
  projectId: string
  total: number
  successCount: number
  failedCount: number
  results: Array<{
    taskId: string
    status: "SUCCESS" | "FAILED"
    executionId?: string
    deliverableId?: string
    runtimeMode?: string
    error?: string
    errorCode?: string
  }>
} | null {
  if (!metadata || typeof metadata !== "object") return null
  const obj = metadata as Record<string, unknown>
  if (typeof obj.projectId !== "string") return null
  if (typeof obj.total !== "number") return null
  if (typeof obj.successCount !== "number") return null
  if (typeof obj.failedCount !== "number") return null
  if (!Array.isArray(obj.results)) return null
  return {
    projectId: obj.projectId,
    total: obj.total,
    successCount: obj.successCount,
    failedCount: obj.failedCount,
    results: obj.results as Array<{
      taskId: string
      status: "SUCCESS" | "FAILED"
      executionId?: string
      deliverableId?: string
      runtimeMode?: string
      error?: string
      errorCode?: string
    }>
  }
}

/**
 * POST /api/tasks/scheduler/trigger
 * Trigger project auto-dispatch by:
 * 1) authenticated editor/admin user (manual)
 * 2) scheduler token (automation/cron)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const parsed = taskAutoDispatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          code: "INVALID_REQUEST",
          details: parsed.error.flatten()
        },
        { status: 400 }
      )
    }
    const validated = parsed.data
    const hasExplicitLimit = Object.prototype.hasOwnProperty.call(body, "limit")
    const hasExplicitAutoSubmit = Object.prototype.hasOwnProperty.call(body, "autoSubmit")
    const session = await requireAuthApi()

    const schedulerToken = req.headers.get("x-scheduler-token")
    const configuredToken = process.env.TASK_SCHEDULER_TOKEN
    const hasValidSchedulerToken =
      Boolean(configuredToken) &&
      Boolean(schedulerToken) &&
      schedulerToken === configuredToken

    let actorUserId: string | null = null
    let triggerMode: "MANUAL" | "SCHEDULED" = "MANUAL"

    if (session?.user) {
      const membership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: validated.projectId,
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
      const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
      if (roleHierarchy[membership.role] < roleHierarchy[ProjectRole.EDITOR]) {
        return NextResponse.json(
          { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
          { status: 403 }
        )
      }
      actorUserId = session.user.id
      triggerMode = "MANUAL"
    } else if (hasValidSchedulerToken) {
      actorUserId = await resolveProjectSystemActor(validated.projectId)
      if (!actorUserId) {
        return NextResponse.json(
          { error: "No valid project actor found for scheduler trigger", code: "PROJECT_ACTOR_NOT_FOUND" },
          { status: 500 }
        )
      }
      triggerMode = "SCHEDULED"
    } else {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const schedulerConfig = await resolveProjectSchedulerConfig(validated.projectId)
    if (!schedulerConfig.enabled) {
      return NextResponse.json(
        { error: "Project scheduler is disabled", code: "SCHEDULER_DISABLED" },
        { status: 400 }
      )
    }
    const effectiveLimit = hasExplicitLimit ? validated.limit : schedulerConfig.defaultLimit
    const effectiveAutoSubmit = hasExplicitAutoSubmit ? validated.autoSubmit : schedulerConfig.defaultAutoSubmit

    const recentBatchLogs = await db.activityLog.findMany({
      where: {
        projectId: validated.projectId,
        taskId: null,
        action: ActionType.TASK_UPDATED,
        createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_LOOKBACK_MS) }
      },
      orderBy: { createdAt: "desc" },
      select: {
        metadata: true,
        createdAt: true
      }
    })
    const dispatchPolicy = resolveProjectDispatchPolicyFromLogs(recentBatchLogs)

    if (validated.idempotencyKey) {
      const duplicatedLog = recentBatchLogs.find(
        (log) =>
          getMetadataType(log.metadata) === "AGENT_AUTO_DISPATCH_BATCH_COMPLETED" &&
          getMetadataIdempotencyKey(log.metadata) === validated.idempotencyKey
      )
      if (duplicatedLog) {
        const batchResult = getMetadataBatchResult(duplicatedLog.metadata)
        if (batchResult) {
          return NextResponse.json({
            ...batchResult,
            deduplicated: true,
            triggerMode
          })
        }
      }
    }

    const latestStarted = recentBatchLogs.find(
      (log) => getMetadataType(log.metadata) === "AGENT_AUTO_DISPATCH_BATCH_STARTED"
    )
    if (latestStarted && Date.now() - latestStarted.createdAt.getTime() < DISPATCH_CONFLICT_WINDOW_MS) {
      return NextResponse.json(
        { error: "Another auto-dispatch batch is running", code: "AUTO_DISPATCH_CONFLICT" },
        { status: 409 }
      )
    }

    const batchId = crypto.randomUUID()
    await db.activityLog.create({
      data: {
        projectId: validated.projectId,
        taskId: null,
        userId: actorUserId,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "AGENT_AUTO_DISPATCH_BATCH_STARTED",
          batchId,
          idempotencyKey: validated.idempotencyKey || null,
          limit: effectiveLimit,
          autoSubmit: effectiveAutoSubmit,
          taskIds: validated.taskIds || null,
          triggerMode,
          schedulerConfigSource: schedulerConfig.source
        }
      }
    })

    const tasks = await db.task.findMany({
      where: {
        projectId: validated.projectId,
        assignmentMode: AssignmentMode.AI_AUTO,
        status: TaskStatus.PENDING,
        ...(validated.taskIds?.length
          ? { id: { in: validated.taskIds } }
          : {}),
        assigneeType: {
          in: [AssigneeType.AGENT, AssigneeType.FUNCTIONAL_AGENT]
        }
      },
      orderBy: [
        { priority: "desc" },
        { dueDate: "asc" },
        { createdAt: "asc" }
      ],
      take: effectiveLimit,
      select: {
        id: true,
        title: true,
        description: true,
        specMarkdown: true,
        projectId: true,
        status: true,
        startedAt: true,
        assigneeType: true,
        assigneeId: true,
        agentId: true,
        functionalAgentType: true
      }
    })

    const activeAgents = await db.agent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        capabilities: true,
        updatedAt: true
      }
    })
    const candidateAgents = dispatchPolicy.onlineOnly
      ? activeAgents.filter((agent) => isAgentOnline(agent.updatedAt))
      : activeAgents

    const results: Array<{
      taskId: string
      status: "SUCCESS" | "FAILED"
      executionId?: string
      deliverableId?: string
      runtimeMode?: string
      error?: string
      errorCode?: string
    }> = []

    for (const task of tasks) {
      const now = new Date()
      const executionId = crypto.randomUUID()

      try {
        const recentLogs = await db.activityLog.findMany({
          where: {
            taskId: task.id,
            action: ActionType.TASK_UPDATED,
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
          },
          select: {
            metadata: true
          }
        })
        const recentRuns = recentLogs.filter(
          (log) => getMetadataType(log.metadata) === "AGENT_RUN_TRIGGERED"
        ).length
        if (recentRuns >= RUN_RATE_LIMIT_PER_HOUR) {
          throw new AgentRuntimeError(
            "TASK_RUN_RATE_LIMITED",
            `Task run rate limit exceeded (${RUN_RATE_LIMIT_PER_HOUR}/hour)`,
            429
          )
        }

        let targetAgentId = task.agentId
        if (
          targetAgentId &&
          !candidateAgents.some((agent) => agent.id === targetAgentId)
        ) {
          targetAgentId = null
        }
        if (!targetAgentId && task.assigneeType === AssigneeType.FUNCTIONAL_AGENT) {
          const preferred = pickPreferredAgent(candidateAgents, task.functionalAgentType)
          targetAgentId = preferred.agentId
          if (!targetAgentId) {
            throw new AgentRuntimeError(
              dispatchPolicy.onlineOnly ? "AUTO_DISPATCH_NO_ONLINE_AGENT" : "AUTO_DISPATCH_NO_AGENT",
              dispatchPolicy.onlineOnly
                ? `No online agent available for queue domain ${task.functionalAgentType || "UNSPECIFIED"}`
                : `No active agent available for queue domain ${task.functionalAgentType || "UNSPECIFIED"}`,
              400
            )
          }
        }
        if (!targetAgentId) {
          throw new AgentRuntimeError(
            dispatchPolicy.onlineOnly ? "AUTO_DISPATCH_NO_ONLINE_AGENT" : "AUTO_DISPATCH_NO_AGENT",
            dispatchPolicy.onlineOnly
              ? "No online agent available for dispatch"
              : "No active agent available for dispatch",
            400
          )
        }

        await db.task.update({
          where: { id: task.id },
          data: {
            assigneeType: AssigneeType.AGENT,
            assigneeId: null,
            agentId: targetAgentId,
            status: TaskStatus.IN_PROGRESS,
            claimedAt: task.startedAt ? undefined : now,
            startedAt: task.startedAt || now
          }
        })

        const runtimeResult = await executeTaskWithAgent({
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            specMarkdown: task.specMarkdown,
            agentId: targetAgentId,
            functionalAgentType: task.functionalAgentType as FunctionalAgentType | null
          },
          executionId,
          executionNotes: `Triggered by ${triggerMode} scheduler`
        })

        const wrappedOutput = `# Agent Execution Output

- Execution ID: ${executionId}
- Triggered At: ${now.toISOString()}
- Triggered By: ${actorUserId}
- Target: ${runtimeResult.targetAgent}
- Runtime Mode: ${runtimeResult.mode}
- Source: Scheduler trigger (${triggerMode})

## Output
${runtimeResult.output}
`

        const deliverable = await db.deliverable.create({
          data: {
            taskId: task.id,
            name: `${task.title} - Scheduler Run ${now.toISOString().slice(0, 19)}`,
            type: "markdown",
            content: wrappedOutput,
            status: effectiveAutoSubmit ? DeliverableStatus.SUBMITTED : DeliverableStatus.DRAFT,
            submittedAt: effectiveAutoSubmit ? now : null
          },
          select: {
            id: true
          }
        })

        await db.activityLog.create({
          data: {
            projectId: task.projectId,
            taskId: task.id,
            userId: actorUserId,
            action: ActionType.TASK_UPDATED,
            metadata: {
              type: "AGENT_AUTO_DISPATCHED",
              executionId,
              deliverableId: deliverable.id,
              runtimeMode: runtimeResult.mode,
              triggerMode,
              targetAgentOnline: isAgentOnline(
                activeAgents.find((agent) => agent.id === targetAgentId)?.updatedAt
              ),
              dispatchPolicyOnlineOnly: dispatchPolicy.onlineOnly
            }
          }
        })

        results.push({
          taskId: task.id,
          status: "SUCCESS",
          executionId,
          deliverableId: deliverable.id,
          runtimeMode: runtimeResult.mode
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        const errorCode = error instanceof AgentRuntimeError ? error.code : "UNKNOWN_ERROR"
        await db.activityLog.create({
          data: {
            projectId: task.projectId,
            taskId: task.id,
            userId: actorUserId,
            action: ActionType.TASK_UPDATED,
            metadata: {
              type: "AGENT_AUTO_DISPATCH_FAILED",
              executionId,
              error: errorMessage,
              errorCode,
              triggerMode
            }
          }
        })
        results.push({
          taskId: task.id,
          status: "FAILED",
          executionId,
          error: errorMessage,
          errorCode
        })
      }
    }

    const successCount = results.filter((r) => r.status === "SUCCESS").length
    const payload = {
      projectId: validated.projectId,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      triggerMode
    }

    await db.activityLog.create({
      data: {
        projectId: validated.projectId,
        taskId: null,
        userId: actorUserId,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED",
          batchId,
          idempotencyKey: validated.idempotencyKey || null,
          ...payload
        }
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Scheduler trigger error:", error)
    return NextResponse.json(
      { error: "Failed to trigger scheduler dispatch", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
