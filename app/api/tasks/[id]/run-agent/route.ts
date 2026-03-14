import { requireAuth } from "@/lib/auth/rbac"
import { AgentRuntimeError, executeTaskWithAgent } from "@/lib/agents/runtime"
import { db } from "@/lib/db"
import { ActionType, DeliverableStatus, ProjectRole, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"

const runAgentSchema = z.object({
  executionNotes: z.string().max(1000).optional(),
  autoSubmit: z.boolean().optional().default(true),
  idempotencyKey: z.string().min(8).max(128).optional()
})

const RUN_RATE_LIMIT_PER_HOUR = 5
const RUN_CONFLICT_WINDOW_MS = 60 * 1000

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

function getMetadataDeliverableId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const deliverableId = (metadata as { deliverableId?: unknown }).deliverableId
  return typeof deliverableId === "string" ? deliverableId : null
}

/**
 * POST /api/tasks/[id]/run-agent - Trigger agent execution for an agent-queue task
 * Requires: EDITOR+ role on project
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const rawBody = await req.text()
    let body: unknown = {}
    if (rawBody.trim().length > 0) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON payload", code: "INVALID_JSON" },
          { status: 400 }
        )
      }
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const validated = runAgentSchema.parse(body)

    const task = await db.task.findUnique({
      where: { id },
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

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    if (roleHierarchy[membership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    if (task.assigneeType === "HUMAN") {
      return NextResponse.json(
        { error: "Task is not configured for agent execution", code: "TASK_NOT_AGENT_EXECUTABLE" },
        { status: 400 }
      )
    }

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return NextResponse.json(
        { error: "Task is not executable in current status", code: "TASK_NOT_AGENT_EXECUTABLE" },
        { status: 400 }
      )
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentLogs = await db.activityLog.findMany({
      where: {
        taskId: task.id,
        action: ActionType.TASK_UPDATED,
        createdAt: { gte: oneHourAgo }
      },
      orderBy: { createdAt: "desc" },
      select: {
        metadata: true,
        createdAt: true
      }
    })

    const recentTriggers = recentLogs.filter(
      (log) => getMetadataType(log.metadata) === "AGENT_RUN_TRIGGERED"
    )
    if (recentTriggers.length >= RUN_RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Task run rate limit exceeded (${RUN_RATE_LIMIT_PER_HOUR}/hour)`,
          code: "TASK_RUN_RATE_LIMITED"
        },
        { status: 429 }
      )
    }

    if (validated.idempotencyKey) {
      const duplicated = recentTriggers.find(
        (log) => getMetadataIdempotencyKey(log.metadata) === validated.idempotencyKey
      )
      if (duplicated) {
        const deliverableId = getMetadataDeliverableId(duplicated.metadata)
        const existingDeliverable = deliverableId
          ? await db.deliverable.findUnique({
              where: { id: deliverableId },
              select: { id: true, name: true, status: true, createdAt: true }
            })
          : null
        return NextResponse.json({
          taskId: task.id,
          deduplicated: true,
          deliverable: existingDeliverable,
          status: task.status
        })
      }
    }

    const latestTriggered = recentTriggers[0]
    if (latestTriggered && Date.now() - latestTriggered.createdAt.getTime() < RUN_CONFLICT_WINDOW_MS) {
      return NextResponse.json(
        { error: "Another agent run is in progress", code: "AGENT_RUN_CONFLICT" },
        { status: 409 }
      )
    }

    const now = new Date()
    const executionId = crypto.randomUUID()

    const deliverable = await db.deliverable.create({
      data: {
        taskId: task.id,
        name: `${task.title} - Agent Run ${now.toISOString().slice(0, 19)}`,
        type: "markdown",
        content: "",
        status: validated.autoSubmit ? DeliverableStatus.SUBMITTED : DeliverableStatus.DRAFT,
        submittedAt: validated.autoSubmit ? now : null
      },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true
      }
    })

    const taskUpdate: {
      status?: TaskStatus
      startedAt?: Date
    } = {}
    if (task.status === TaskStatus.PENDING) {
      taskUpdate.status = TaskStatus.IN_PROGRESS
    }
    if (!task.startedAt) {
      taskUpdate.startedAt = now
    }

    if (Object.keys(taskUpdate).length > 0) {
      await db.task.update({
        where: { id: task.id },
        data: taskUpdate
      })
    }

    let runtimeResult: Awaited<ReturnType<typeof executeTaskWithAgent>>
    try {
      runtimeResult = await executeTaskWithAgent({
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          specMarkdown: task.specMarkdown,
          agentId: task.agentId,
          functionalAgentType: task.functionalAgentType
        },
        executionId,
        executionNotes: validated.executionNotes
      })
    } catch (runtimeError) {
      const errorMessage = runtimeError instanceof Error ? runtimeError.message : "Unknown runtime error"

      await db.deliverable.update({
        where: { id: deliverable.id },
        data: {
          status: DeliverableStatus.DRAFT,
          submittedAt: null,
          content: `# Agent Execution Failed

- Execution ID: ${executionId}
- Triggered At: ${now.toISOString()}
- Triggered By: ${session.user!.id}
- Error: ${errorMessage}
`
        }
      })

      await db.activityLog.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          userId: session.user!.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "AGENT_RUN_FAILED",
            executionId,
            deliverableId: deliverable.id,
            error: errorMessage
          }
        }
      })

      throw runtimeError
    }

    const wrappedOutput = `# Agent Execution Output

- Execution ID: ${executionId}
- Triggered At: ${now.toISOString()}
- Triggered By: ${session.user!.id}
- Target: ${runtimeResult.targetAgent}
- Runtime Mode: ${runtimeResult.mode}

## Output
${runtimeResult.output}
`

    await db.deliverable.update({
      where: { id: deliverable.id },
      data: { content: wrappedOutput }
    })

    await db.activityLog.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "AGENT_RUN_TRIGGERED",
          executionId,
          targetAgent: runtimeResult.targetAgent,
          runtimeMode: runtimeResult.mode,
          deliverableId: deliverable.id,
          autoSubmit: validated.autoSubmit,
          idempotencyKey: validated.idempotencyKey || null
        }
      }
    })

    return NextResponse.json({
      taskId: task.id,
      executionId,
      deliverable,
      status: taskUpdate.status ?? task.status
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    if (error instanceof AgentRuntimeError) {
      console.error("Run agent runtime error:", error)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }
    console.error("Run agent error:", error)
    return NextResponse.json(
      { error: "Failed to run agent", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
