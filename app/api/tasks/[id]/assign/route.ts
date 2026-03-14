import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { resolveProjectDispatchPolicy } from "@/lib/tasks/dispatch-policy"
import { taskConfirmAssignSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import {
  ActionType,
  AssigneeType,
  NotificationType,
  ProjectRole,
  TaskAssignmentAction
} from "@prisma/client"
import { ZodError } from "zod"

/**
 * POST /api/tasks/[id]/assign - Confirm task assignment to human/agent/agent-queue
 * Requires: EDITOR+ role on project
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
    const validated = taskConfirmAssignSchema.parse(body)

    const task = await db.task.findUnique({
      where: { id }
    })

    if (!task) {
      return NextResponse.json(
        { error: "Task not found", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify project access with EDITOR role
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
    const dispatchPolicy = await resolveProjectDispatchPolicy(task.projectId)

    let toAssigneeId: string | null = null
    let toAgentId: string | null = null

    // Validate and normalize target
    if (validated.assigneeType === AssigneeType.HUMAN) {
      const assigneeId = validated.assigneeId!
      const assigneeMember = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: task.projectId,
            userId: assigneeId
          }
        }
      })
      if (!assigneeMember) {
        return NextResponse.json(
          { error: "Assignee is not a project member", code: "INVALID_ASSIGNMENT_PAYLOAD" },
          { status: 400 }
        )
      }
      toAssigneeId = assigneeId
    } else {
      if (validated.assigneeType === AssigneeType.AGENT) {
        if (!validated.agentId) {
          return NextResponse.json(
            { error: "agentId is required when assigneeType is AGENT", code: "INVALID_ASSIGNMENT_PAYLOAD" },
            { status: 400 }
          )
        }
        const agent = await db.agent.findUnique({
          where: { id: validated.agentId }
        })
        if (!agent || !agent.isActive) {
          return NextResponse.json(
            { error: "Agent not found or inactive", code: "INVALID_ASSIGNMENT_PAYLOAD" },
            { status: 400 }
          )
        }
        if (dispatchPolicy.onlineOnly && !isAgentOnline(agent.updatedAt)) {
          return NextResponse.json(
            { error: "Assigned agent is offline under online-only policy", code: "AGENT_OFFLINE_BY_POLICY" },
            { status: 400 }
          )
        }
        toAgentId = validated.agentId
      }

      if (validated.assigneeType === AssigneeType.FUNCTIONAL_AGENT) {
        if (!validated.functionalAgentType) {
          return NextResponse.json(
            { error: "Agent queue domain is required (field: functionalAgentType)", code: "INVALID_ASSIGNMENT_PAYLOAD" },
            { status: 400 }
          )
        }
        if (validated.agentId) {
          const agent = await db.agent.findUnique({
            where: { id: validated.agentId }
          })
          if (!agent || !agent.isActive) {
            return NextResponse.json(
              { error: "Agent not found or inactive", code: "INVALID_ASSIGNMENT_PAYLOAD" },
              { status: 400 }
            )
          }
          if (dispatchPolicy.onlineOnly && !isAgentOnline(agent.updatedAt)) {
            return NextResponse.json(
              { error: "Assigned agent is offline under online-only policy", code: "AGENT_OFFLINE_BY_POLICY" },
              { status: 400 }
            )
          }
          toAgentId = validated.agentId
        }
      }
    }

    // Update task assignment
    const updatedTask = await db.task.update({
      where: { id },
      data: {
        assigneeType: validated.assigneeType,
        assigneeId: toAssigneeId,
        agentId: toAgentId,
        functionalAgentType: validated.functionalAgentType ?? null,
        assignmentMode: validated.assignmentMode
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
        action: task.assigneeId || task.agentId ? TaskAssignmentAction.REASSIGNED : TaskAssignmentAction.ASSIGNED,
        actorUserId: session.user!.id,
        fromType: task.assigneeType,
        fromAssigneeId: task.assigneeId,
        fromAgentId: task.agentId,
        toType: validated.assigneeType,
        toAssigneeId,
        toAgentId,
        reason: validated.reason ?? null,
        metadata: {
          assignmentMode: validated.assignmentMode,
          source: validated.source ?? null,
          functionalAgentType: validated.functionalAgentType ?? null
        }
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_ASSIGNED,
        metadata: {
          assigneeType: validated.assigneeType,
          assigneeId: toAssigneeId || toAgentId,
          assignmentMode: validated.assignmentMode,
          source: validated.source ?? null,
          functionalAgentType: validated.functionalAgentType ?? null
        }
      }
    })

    // Send notification to human assignee
    if (validated.assigneeType === AssigneeType.HUMAN && toAssigneeId) {
      await db.notification.create({
        data: {
          userId: toAssigneeId,
          type: NotificationType.TASK_ASSIGNED,
          title: "Task Assigned",
          content: `You have been assigned to task: ${task.title}`,
          link: `/projects/${task.projectId}/tasks/${task.id}`
        }
      })
    }

    return NextResponse.json(updatedTask)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Task assignment error:", error)
    return NextResponse.json(
      { error: "Failed to assign task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
