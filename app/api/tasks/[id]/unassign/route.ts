import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import {
  ActionType,
  AssigneeType,
  ProjectRole,
  TaskAssignmentAction
} from "@prisma/client"

/**
 * POST /api/tasks/[id]/unassign - Remove current task assignee/agent
 * Requires: EDITOR+ role on project
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

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

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    if (roleHierarchy[membership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const updatedTask = await db.task.update({
      where: { id },
      data: {
        assigneeType: AssigneeType.HUMAN,
        assigneeId: null,
        agentId: null,
        functionalAgentType: null,
        claimedAt: null
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    await db.taskAssignmentLog.create({
      data: {
        taskId: task.id,
        action: TaskAssignmentAction.UNCLAIMED,
        actorUserId: session.user!.id,
        fromType: task.assigneeType,
        fromAssigneeId: task.assigneeId,
        fromAgentId: task.agentId,
        toType: AssigneeType.HUMAN,
        toAssigneeId: null,
        toAgentId: null
      }
    })

    await db.activityLog.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          unassigned: true
        }
      }
    })

    return NextResponse.json(updatedTask)
  } catch (error) {
    console.error("Task unassign error:", error)
    return NextResponse.json(
      { error: "Failed to unassign task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
