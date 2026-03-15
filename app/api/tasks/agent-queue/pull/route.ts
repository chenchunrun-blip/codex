import { requireAgentAuth } from "@/lib/auth/agent-auth"
import { db } from "@/lib/db"
import { resolveProjectSystemActor } from "@/lib/tasks/system-actor"
import { agentQueuePullSchema } from "@/lib/utils/validation"
import { ActionType, AssigneeType, AssignmentMode, TaskAssignmentAction, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"
import { ZodError } from "zod"

/**
 * POST /api/tasks/agent-queue/pull
 * Agent protocol:
 * - Auth: x-agent-id + Authorization: Bearer <agent_key> (or x-agent-key)
 * - Pulls next task from queue domain
 * - claim=true (default): atomically claim candidate task
 * - claim=false: peek only
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAgentAuth(req)
    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error, code: authResult.code },
        { status: authResult.status }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const validated = agentQueuePullSchema.parse(body)
    const now = new Date()

    await db.agent.update({
      where: { id: authResult.agent.id },
      data: {
        updatedAt: now
      }
    })

    const candidate = await db.task.findFirst({
      where: {
        projectId: validated.projectId,
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        functionalAgentType: validated.functionalAgentType,
        OR: [
          { agentId: null },
          { agentId: authResult.agent.id }
        ]
      },
      orderBy: [
        { priority: "desc" },
        { dueDate: "asc" },
        { createdAt: "asc" }
      ],
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        dueDate: true,
        specMarkdown: true,
        projectId: true,
        functionalAgentType: true,
        assignmentMode: true
      }
    })

    if (!candidate) {
      return NextResponse.json({
        task: null,
        claimed: false,
        agentId: authResult.agent.id,
        queueDomain: validated.functionalAgentType
      })
    }

    if (!validated.claim) {
      return NextResponse.json({
        task: candidate,
        claimed: false,
        agentId: authResult.agent.id,
        queueDomain: validated.functionalAgentType
      })
    }

    // Claim with optimistic concurrency guard.
    const claimResult = await db.task.updateMany({
      where: {
        id: candidate.id,
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        claimedAt: null
      },
      data: {
        assigneeType: AssigneeType.AGENT,
        assigneeId: null,
        agentId: authResult.agent.id,
        status: TaskStatus.IN_PROGRESS,
        claimedAt: now,
        startedAt: now,
        assignmentMode:
          candidate.assignmentMode === AssignmentMode.MANUAL
            ? AssignmentMode.AI_AUTO
            : candidate.assignmentMode
      }
    })

    if (claimResult.count === 0) {
      return NextResponse.json(
        {
          error: "Task claim conflict, please pull again",
          code: "AGENT_QUEUE_CLAIM_CONFLICT"
        },
        { status: 409 }
      )
    }

    const claimedTask = await db.task.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        dueDate: true,
        specMarkdown: true,
        projectId: true,
        assigneeType: true,
        assigneeId: true,
        agentId: true,
        functionalAgentType: true,
        assignmentMode: true,
        claimedAt: true,
        startedAt: true
      }
    })

    if (!claimedTask) {
      return NextResponse.json(
        { error: "Task not found after claim", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    const actorUserId = await resolveProjectSystemActor(candidate.projectId)
    if (!actorUserId) {
      return NextResponse.json(
        { error: "No valid project actor found for logging", code: "PROJECT_ACTOR_NOT_FOUND" },
        { status: 500 }
      )
    }
    await db.taskAssignmentLog.create({
      data: {
        taskId: claimedTask.id,
        action: TaskAssignmentAction.CLAIMED,
        actorUserId,
        fromType: AssigneeType.FUNCTIONAL_AGENT,
        fromAssigneeId: null,
        fromAgentId: null,
        toType: AssigneeType.AGENT,
        toAssigneeId: null,
        toAgentId: authResult.agent.id,
        reason: "Claimed by agent queue pull",
        metadata: {
          source: "agent_queue_pull",
          queueDomain: validated.functionalAgentType
        }
      }
    })

    await db.activityLog.create({
      data: {
        projectId: claimedTask.projectId,
        taskId: claimedTask.id,
        userId: actorUserId,
        action: ActionType.TASK_ASSIGNED,
        metadata: {
          source: "agent_queue_pull",
          queueDomain: validated.functionalAgentType,
          agentId: authResult.agent.id
        }
      }
    })

    return NextResponse.json({
      task: claimedTask,
      claimed: true,
      agentId: authResult.agent.id,
      queueDomain: validated.functionalAgentType
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Agent queue pull error:", error)
    return NextResponse.json(
      { error: "Failed to pull task from agent queue", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
