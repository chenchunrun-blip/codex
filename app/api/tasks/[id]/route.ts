import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { computeTaskRisk } from "@/lib/tasks/risk"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { taskUpdateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import {
  ActionType,
  NotificationType,
  ProjectRole,
  SpecValidationStatus,
  TaskAssignmentAction,
  TaskStatus
} from "@prisma/client"
import { ZodError } from "zod"

/**
 * GET /api/tasks/[id] - Get task details
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const task = await db.task.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        },
        creator: {
          select: {
            id: true,
            name: true,
            nickname: true,
            email: true
          }
        },
        assignee: {
          select: {
            id: true,
            name: true,
            nickname: true,
            avatar: true,
            email: true
          }
        },
        agent: {
          select: {
            id: true,
            name: true,
            displayName: true,
            type: true,
            capabilities: true
          }
        },
        deliverables: {
          include: {
            file: {
              select: {
                id: true,
                name: true,
                fileType: true
              }
            },
            reviewer: {
              select: {
                id: true,
                name: true,
                nickname: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        activities: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                nickname: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        assignmentLogs: {
          include: {
            actor: {
              select: {
                id: true,
                name: true,
                nickname: true,
                email: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        }
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

    const activities = Array.isArray(task.activities) ? task.activities : []
    const latestRunActivity = activities.find((item) => {
      if (!item.metadata || typeof item.metadata !== "object") return false
      const type = (item.metadata as { type?: unknown }).type
      return type === "AGENT_RUN_TRIGGERED" || type === "AGENT_RUN_FAILED"
    })
    const latestRunType =
      latestRunActivity && latestRunActivity.metadata && typeof latestRunActivity.metadata === "object"
        ? (latestRunActivity.metadata as { type?: unknown }).type
        : null
    const latestAgentRun =
      latestRunType === "AGENT_RUN_TRIGGERED" || latestRunType === "AGENT_RUN_FAILED"
        ? {
            status: latestRunType === "AGENT_RUN_FAILED" ? "FAILED" : "SUCCESS",
            triggeredAt: latestRunActivity!.createdAt.toISOString()
          }
        : null

    const specQualityScore = task.specMarkdown ? lintTaskSpecMarkdown(task.specMarkdown).score : null
    const onlineAgentsByDomain = new Map<string, number>()
    if (task.assigneeType === "FUNCTIONAL_AGENT" && task.functionalAgentType) {
      const matchedAgents = await db.agent.findMany({
        where: { isActive: true },
        select: {
          capabilities: true,
          updatedAt: true
        }
      })
      for (const agent of matchedAgents) {
        if (!Array.isArray(agent.capabilities) || !isAgentOnline(agent.updatedAt)) continue
        for (const capability of agent.capabilities) {
          if (typeof capability !== "string") continue
          const key = capability.trim().toUpperCase()
          if (!key) continue
          onlineAgentsByDomain.set(key, (onlineAgentsByDomain.get(key) || 0) + 1)
        }
      }
    }
    const latestAgentRunStatus: "SUCCESS" | "FAILED" | null =
      latestRunType === "AGENT_RUN_FAILED"
        ? "FAILED"
        : latestRunType === "AGENT_RUN_TRIGGERED"
          ? "SUCCESS"
          : null
    const risk = computeTaskRisk({
      dueDate: task.dueDate ? new Date(task.dueDate) : null,
      latestAgentRunStatus,
      specQualityScore,
      assigneeType: task.assigneeType,
      functionalAgentType: task.functionalAgentType ?? null,
      status: task.status,
      onlineAgentsByDomain
    })

    return NextResponse.json({
      ...task,
      latestAgentRun,
      specQualityScore,
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      riskReasons: risk.riskReasons
    })
  } catch (error) {
    console.error("Task fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tasks/[id] - Update task
 * Requires: EDITOR+ role on project
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
    const validated = taskUpdateSchema.parse(body)

    const task = await db.task.findUnique({
      where: { id },
      include: { project: true }
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

    const assignmentChanged =
      validated.assigneeType !== undefined ||
      validated.assigneeId !== undefined ||
      validated.agentId !== undefined ||
      validated.functionalAgentType !== undefined

    // Build update data
    const updateData: any = {}
    if (validated.title !== undefined) updateData.title = validated.title
    if (validated.description !== undefined) updateData.description = validated.description
    if (validated.specMarkdown !== undefined) {
      updateData.specMarkdown = validated.specMarkdown
      updateData.specValidationStatus = SpecValidationStatus.VALID
      updateData.specValidationErrors = null
    }
    if (validated.assignmentMode !== undefined) updateData.assignmentMode = validated.assignmentMode
    if (validated.status !== undefined) {
      updateData.status = validated.status
      // Update timestamps based on status
      if (validated.status === TaskStatus.IN_PROGRESS && !task.startedAt) {
        updateData.startedAt = new Date()
      }
      if (validated.status === TaskStatus.COMPLETED && !task.completedAt) {
        updateData.completedAt = new Date()
      }
    }
    if (validated.priority !== undefined) updateData.priority = validated.priority
    if (validated.assigneeType !== undefined) updateData.assigneeType = validated.assigneeType
    if (validated.assigneeId !== undefined) updateData.assigneeId = validated.assigneeId
    if (validated.agentId !== undefined) updateData.agentId = validated.agentId
    if (validated.functionalAgentType !== undefined) updateData.functionalAgentType = validated.functionalAgentType
    if (validated.claimedAt !== undefined) updateData.claimedAt = validated.claimedAt ? new Date(validated.claimedAt) : null
    if (validated.dueDate !== undefined) updateData.dueDate = validated.dueDate ? new Date(validated.dueDate) : null

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
          changes: Object.keys(updateData)
        }
      }
    })

    if (assignmentChanged) {
      await db.taskAssignmentLog.create({
        data: {
          taskId: task.id,
          action: task.assigneeId || task.agentId ? TaskAssignmentAction.REASSIGNED : TaskAssignmentAction.ASSIGNED,
          actorUserId: session.user!.id,
          fromType: task.assigneeType,
          fromAssigneeId: task.assigneeId,
          fromAgentId: task.agentId,
          toType: updatedTask.assigneeType,
          toAssigneeId: updatedTask.assigneeId,
          toAgentId: updatedTask.agentId,
          metadata: {
            assignmentMode: updatedTask.assignmentMode,
            functionalAgentType: updatedTask.functionalAgentType
          }
        }
      })
    }

    // Send notification for status changes
    if (validated.status && validated.status !== task.status) {
      // Notify assignee about status change
      if (task.assigneeId && task.assigneeId !== session.user!.id) {
        await db.notification.create({
          data: {
            userId: task.assigneeId,
            type: NotificationType.TASK_UPDATED,
            title: "Task Status Updated",
            content: `Task "${task.title}" status changed to ${validated.status}`,
            link: `/projects/${task.projectId}/tasks/${task.id}`
          }
        })
      }
    }

    // Send notification for new assignment
    if (validated.assigneeId && validated.assigneeId !== task.assigneeId) {
      await db.notification.create({
        data: {
          userId: validated.assigneeId,
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
        { error: "Invalid task payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Task update error:", error)
    return NextResponse.json(
      { error: "Failed to update task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id] - Delete task
 * Requires: ADMIN role on project
 */
export async function DELETE(
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

    // Verify project access with ADMIN role
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

    if (membership.role !== ProjectRole.ADMIN) {
      return NextResponse.json(
        { error: "Only admins can delete tasks", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    await db.task.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Task deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
