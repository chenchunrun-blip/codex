import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deliverableReviewSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import {
  ProjectRole,
  NotificationType,
  DeliverableStatus,
  ActionType,
  AssigneeType,
  FunctionalAgentType,
  TaskAssignmentAction,
  TaskStatus
} from "@prisma/client"

const DOMAIN_SET = new Set<FunctionalAgentType>([
  FunctionalAgentType.PRODUCT,
  FunctionalAgentType.ENGINEERING,
  FunctionalAgentType.QA,
  FunctionalAgentType.DESIGN,
  FunctionalAgentType.OPERATIONS
])

function inferQueueDomain(
  currentDomain: FunctionalAgentType | null,
  capabilities: unknown
): FunctionalAgentType {
  if (currentDomain) return currentDomain
  if (Array.isArray(capabilities)) {
    for (const item of capabilities) {
      if (typeof item !== "string") continue
      const normalized = item.trim().toUpperCase() as FunctionalAgentType
      if (DOMAIN_SET.has(normalized)) return normalized
    }
  }
  return FunctionalAgentType.ENGINEERING
}

function buildRevisionAppendix(feedback?: string): string {
  const stamp = new Date().toISOString()
  return `

## Revision Request
- Requested At: ${stamp}
- Reviewer Feedback: ${feedback?.trim() || "No feedback provided."}
`
}

/**
 * POST /api/deliverables/[id]/review - Review deliverable (approve/reject)
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
          { error: "Invalid review payload", code: "INVALID_REVIEW_PAYLOAD" },
          { status: 400 }
        )
      }
    }
    const validated = deliverableReviewSchema.parse(body)

    const deliverable = await db.deliverable.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        taskId: true,
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
            status: true,
            assigneeType: true,
            assigneeId: true,
            agentId: true,
            functionalAgentType: true,
            claimedAt: true,
            specMarkdown: true,
            project: true,
            assignmentLogs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                action: true,
                fromType: true,
                fromAssigneeId: true,
                fromAgentId: true,
                toType: true,
                toAssigneeId: true,
                toAgentId: true
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
                displayName: true,
                capabilities: true
              }
            }
          }
        }
      }
    })

    if (!deliverable) {
      return NextResponse.json(
        { error: "Deliverable not found", code: "DELIVERABLE_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify project access with EDITOR role
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: deliverable.task.projectId,
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

    // Update deliverable status
    const updatedDeliverable = await db.deliverable.update({
      where: { id },
      data: {
        status: validated.status === "APPROVED" ? DeliverableStatus.APPROVED : DeliverableStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: session.user!.id
        // Note: reviewFeedback is stored in activityLog metadata, not in content field
        // The content field stores the deliverable content as a string
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            projectId: true
          }
        },
        file: {
          select: {
            id: true,
            name: true,
            fileType: true
          }
        }
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: deliverable.task.projectId,
        taskId: deliverable.taskId,
        userId: session.user!.id,
        action: validated.status === "APPROVED" ? ActionType.DELIVERABLE_APPROVED : ActionType.DELIVERABLE_REJECTED,
        metadata: {
          deliverableId: deliverable.id,
          deliverableName: deliverable.name,
          feedback: validated.feedback
        }
      }
    })

    let requeueResult: {
      requeued: boolean
      queueDomain?: FunctionalAgentType
      taskStatus?: TaskStatus
    } = { requeued: false }

    if (
      validated.status === "REJECTED" &&
      deliverable.task.assigneeType !== AssigneeType.HUMAN
    ) {
      const queueDomain = inferQueueDomain(
        deliverable.task.functionalAgentType,
        deliverable.task.agent?.capabilities
      )
      const previousAssignment = deliverable.task.assignmentLogs[0]
      const appendedSpec = `${deliverable.task.specMarkdown || "# TaskSpec"}${buildRevisionAppendix(validated.feedback)}`

      await db.task.update({
        where: { id: deliverable.task.id },
        data: {
          status: TaskStatus.PENDING,
          assigneeType: AssigneeType.FUNCTIONAL_AGENT,
          assigneeId: null,
          agentId: null,
          functionalAgentType: queueDomain,
          claimedAt: null,
          specMarkdown: appendedSpec
        }
      })

      await db.taskAssignmentLog.create({
        data: {
          taskId: deliverable.task.id,
          action: TaskAssignmentAction.REASSIGNED,
          actorUserId: session.user!.id,
          fromType: previousAssignment?.toType || deliverable.task.assigneeType,
          fromAssigneeId: previousAssignment?.toAssigneeId || deliverable.task.assigneeId,
          fromAgentId: previousAssignment?.toAgentId || deliverable.task.agentId,
          toType: AssigneeType.FUNCTIONAL_AGENT,
          toAssigneeId: null,
          toAgentId: null,
          reason: "Deliverable rejected; task re-queued for revision",
          metadata: {
            trigger: "deliverable_rejected",
            queueDomain,
            feedback: validated.feedback || null
          }
        }
      })

      await db.activityLog.create({
        data: {
          projectId: deliverable.task.projectId,
          taskId: deliverable.task.id,
          userId: session.user!.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "TASK_REQUEUED_AFTER_REJECTION",
            queueDomain,
            deliverableId: deliverable.id
          }
        }
      })

      requeueResult = {
        requeued: true,
        queueDomain,
        taskStatus: TaskStatus.PENDING
      }
    }

    // Notify the assignee (if human) about the review
    if (deliverable.task.assignee) {
      await db.notification.create({
        data: {
          userId: deliverable.task.assignee.id,
          type: NotificationType.TASK_UPDATED,
          title: `Deliverable ${validated.status}`,
          content: `Your deliverable "${deliverable.name}" has been ${validated.status.toLowerCase()}${validated.feedback ? ': ' + validated.feedback : ''}`,
          link: `/projects/${deliverable.task.projectId}/tasks/${deliverable.task.id}/deliverables/${deliverable.id}`
        }
      })
    }

    return NextResponse.json({
      ...updatedDeliverable,
      requeue: requeueResult
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid review payload", code: "INVALID_REVIEW_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Deliverable review error:", error)
    return NextResponse.json(
      { error: "Failed to review deliverable", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
