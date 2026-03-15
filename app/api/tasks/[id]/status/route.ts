import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { taskStatusUpdateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { ProjectRole, TaskStatus, NotificationType, ActionType } from "@prisma/client"
import { ZodError } from "zod"

/**
 * PATCH /api/tasks/[id]/status - Update task status
 * Requires: EDITOR+ role, or task assignee
 */
export async function PATCH(
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
    const validated = taskStatusUpdateSchema.parse(body)

    const task = await db.task.findUnique({
      where: { id },
      include: {
        project: true
      }
    })

    if (!task) {
      return NextResponse.json(
        { error: "Task not found", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify project access
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

    // Check permissions: EDITOR+ or task assignee
    const roleHierarchy = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const isAssignee = task.assigneeId === session.user!.id
    const hasPermission = roleHierarchy[membership.role] >= roleHierarchy.EDITOR || isAssignee

    if (!hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    // Build update data based on status
    const updateData: any = {
      status: validated.status
    }

    if (validated.status === TaskStatus.IN_PROGRESS && !task.startedAt) {
      updateData.startedAt = new Date()
    }

    if (validated.status === TaskStatus.COMPLETED && !task.completedAt) {
      updateData.completedAt = new Date()
    }

    const updatedTask = await db.task.update({
      where: { id },
      data: updateData,
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

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: task.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_STATUS_CHANGED,
        metadata: {
          oldStatus: task.status,
          newStatus: validated.status,
          notes: validated.notes
        }
      }
    })

    // Send notifications
    // Notify project members about important status changes
    if (validated.status === TaskStatus.COMPLETED || validated.status === TaskStatus.REVIEW) {
      const projectMembers = await db.projectMember.findMany({
        where: {
          projectId: task.projectId,
          userId: { not: session.user!.id }
        },
        include: {
          user: {
            select: { id: true }
          }
        }
      })

      for (const member of projectMembers) {
        // Only notify editors and admins
        if (member.role === ProjectRole.EDITOR || member.role === ProjectRole.ADMIN) {
          await db.notification.create({
            data: {
              userId: member.userId,
              type: NotificationType.TASK_UPDATED,
              title: `Task ${validated.status === TaskStatus.COMPLETED ? 'Completed' : 'Ready for Review'}`,
              content: `Task "${task.title}" is now ${validated.status}`,
              link: `/projects/${task.projectId}/tasks/${task.id}`
            }
          })
        }
      }
    }

    return NextResponse.json(updatedTask)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Task status update error:", error)
    return NextResponse.json(
      { error: "Failed to update task status", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
