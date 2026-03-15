import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { taskClaimSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import {
  ActionType,
  AssigneeType,
  NotificationType,
  ProjectRole,
  TaskAssignmentAction,
  TaskStatus
} from "@prisma/client"

/**
 * POST /api/tasks/[id]/claim - Claim task by human or agent queue
 * HUMAN: any project member can claim for self; claiming for others requires EDITOR+
 * FUNCTIONAL_AGENT (Agent Queue): requires EDITOR+ role
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
          { error: "Invalid request payload", code: "INVALID_CLAIM_PAYLOAD" },
          { status: 400 }
        )
      }
    }
    const validated = taskClaimSchema.parse(body)

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

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return NextResponse.json(
        { error: "Task cannot be claimed in current status", code: "TASK_NOT_CLAIMABLE" },
        { status: 400 }
      )
    }

    if (task.claimedAt && task.status === TaskStatus.IN_PROGRESS) {
      return NextResponse.json(
        { error: "Task already claimed", code: "TASK_ALREADY_CLAIMED" },
        { status: 409 }
      )
    }

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const canEdit = roleHierarchy[membership.role] >= roleHierarchy[ProjectRole.EDITOR]

    let toAssigneeId: string | null = null
    let toAgentId: string | null = null

    if (validated.assigneeType === AssigneeType.HUMAN) {
      const targetUserId = validated.assigneeId!

      const assigneeMember = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: task.projectId,
            userId: targetUserId
          }
        }
      })
      if (!assigneeMember) {
        return NextResponse.json(
          { error: "Assignee is not a project member", code: "INVALID_CLAIM_PAYLOAD" },
          { status: 400 }
        )
      }

      if (targetUserId !== session.user!.id && !canEdit) {
        return NextResponse.json(
          { error: "Insufficient permissions to claim for other members", code: "INSUFFICIENT_PERMISSIONS" },
          { status: 403 }
        )
      }

      toAssigneeId = targetUserId
    }

    if (validated.assigneeType === AssigneeType.FUNCTIONAL_AGENT) {
      if (!canEdit) {
        return NextResponse.json(
          { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
          { status: 403 }
        )
      }

      if (validated.agentId) {
        const agent = await db.agent.findUnique({
          where: { id: validated.agentId }
        })
        if (!agent || !agent.isActive) {
          return NextResponse.json(
            { error: "Agent not found or inactive", code: "INVALID_CLAIM_PAYLOAD" },
            { status: 400 }
          )
        }
      }

      toAgentId = validated.agentId ?? null
    }

    const now = new Date()
    const updatedTask = await db.task.update({
      where: { id },
      data: {
        assigneeType: validated.assigneeType,
        assigneeId: toAssigneeId,
        agentId: toAgentId,
        functionalAgentType: validated.functionalAgentType ?? null,
        claimedAt: now,
        status: TaskStatus.IN_PROGRESS,
        startedAt: task.startedAt ?? now
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        },
        assignee: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        },
        agent: {
          select: {
            id: true,
            name: true,
            displayName: true
          }
        }
      }
    })

    await db.taskAssignmentLog.create({
      data: {
        taskId: task.id,
        action: TaskAssignmentAction.CLAIMED,
        actorUserId: session.user!.id,
        fromType: task.assigneeType,
        fromAssigneeId: task.assigneeId,
        fromAgentId: task.agentId,
        toType: validated.assigneeType,
        toAssigneeId,
        toAgentId,
        reason: validated.reason ?? null,
        metadata: {
          functionalAgentType: validated.functionalAgentType ?? null
        }
      }
    })

    await db.activityLog.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_ASSIGNED,
        metadata: {
          claim: true,
          assigneeType: validated.assigneeType,
          assigneeId: toAssigneeId ?? toAgentId,
          functionalAgentType: validated.functionalAgentType ?? null
        }
      }
    })

    if (validated.assigneeType === AssigneeType.HUMAN && toAssigneeId && toAssigneeId !== session.user!.id) {
      await db.notification.create({
        data: {
          userId: toAssigneeId,
          type: NotificationType.TASK_ASSIGNED,
          title: "Task Claimed for You",
          content: `You have been claimed as assignee for task: ${task.title}`,
          link: `/projects/${task.projectId}/tasks/${task.id}`
        }
      })
    }

    return NextResponse.json({
      taskId: updatedTask.id,
      assigneeType: updatedTask.assigneeType,
      assigneeId: updatedTask.assigneeId,
      agentId: updatedTask.agentId,
      functionalAgentType: updatedTask.functionalAgentType,
      claimedAt: updatedTask.claimedAt,
      status: updatedTask.status
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid claim payload",
          code: "INVALID_CLAIM_PAYLOAD",
          details: error.issues
        },
        { status: 400 }
      )
    }
    console.error("Task claim error:", error)
    return NextResponse.json(
      { error: "Failed to claim task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
