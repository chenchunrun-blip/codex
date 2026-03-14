import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { resolveProjectDispatchPolicy } from "@/lib/tasks/dispatch-policy"
import { resolveProjectBottlenecks } from "@/lib/tasks/project-bottlenecks"
import {
  ActionType,
  AssignmentMode,
  FunctionalAgentType,
  AssigneeType,
  ProjectRole,
  SpecValidationStatus,
  TaskStatus
} from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  limit: z.number().int().min(1).max(10).optional().default(5),
  applyDispatchFallback: z.boolean().optional().default(true)
})

function buildRemediationSpec(title: string, action: string): string {
  return `# TaskSpec

## Goal
- Resolve the bottleneck issue: ${title}

## Deliverables
- A concrete remediation change is implemented and documented
- Validation evidence is attached (logs, screenshots, or metrics)

## Requirements
- Apply the recommended action: ${action}
- Keep all project dispatch and assignment rules consistent

## Acceptance Criteria
- Bottleneck indicator is reduced or cleared in the next report
- Human reviewer verifies outcome and marks deliverable approved

## Priority
- HIGH

## Due Date
- ${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`
}

function inferQueueDomainFromTitle(title: string): FunctionalAgentType | null {
  const upper = title.toUpperCase()
  if (upper.includes("ENGINEERING")) return FunctionalAgentType.ENGINEERING
  if (upper.includes("QA")) return FunctionalAgentType.QA
  if (upper.includes("DESIGN")) return FunctionalAgentType.DESIGN
  if (upper.includes("PRODUCT")) return FunctionalAgentType.PRODUCT
  if (upper.includes("OPERATIONS")) return FunctionalAgentType.OPERATIONS
  return null
}

/**
 * POST /api/projects/[id]/bottlenecks/remediation-tasks
 * Generate remediation tasks from current bottlenecks recommendations.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
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

    const bottlenecks = await resolveProjectBottlenecks(id)
    const selected = bottlenecks.recommendations.slice(0, parsed.data.limit)
    const shouldApplyDispatchFallback =
      parsed.data.applyDispatchFallback &&
      bottlenecks.atRiskDomains.length > 0
    let dispatchPolicyUpdate:
      | {
          changed: boolean
          previousOnlineOnly: boolean
          onlineOnly: boolean
          reason: string | null
        }
      | undefined

    if (shouldApplyDispatchFallback) {
      const currentPolicy = await resolveProjectDispatchPolicy(id)
      if (currentPolicy.onlineOnly) {
        await db.activityLog.create({
          data: {
            projectId: id,
            userId: session.user.id,
            action: ActionType.TASK_UPDATED,
            metadata: {
              type: "PROJECT_DISPATCH_POLICY_UPDATED",
              onlineOnly: false,
              triggeredBy: "BOTTLENECKS_REMEDIATION",
              reason: "at-risk queue domains detected with no online agents"
            }
          }
        })
        dispatchPolicyUpdate = {
          changed: true,
          previousOnlineOnly: true,
          onlineOnly: false,
          reason: "Disabled online-only dispatch because at-risk queue domains were detected"
        }
      } else {
        dispatchPolicyUpdate = {
          changed: false,
          previousOnlineOnly: false,
          onlineOnly: false,
          reason: null
        }
      }
    }

    if (selected.length === 0) {
      return NextResponse.json({
        projectId: id,
        created: [],
        total: 0,
        dispatchPolicyUpdate
      })
    }

    const createdTasks = await db.$transaction(
      selected.map((item) => {
        const inferredDomain = item.type === "QUEUE" ? inferQueueDomainFromTitle(item.title) : null
        return db.task.create({
          data: {
            title: `[Remediation] ${item.title}`.slice(0, 200),
            description: item.action,
            specMarkdown: buildRemediationSpec(item.title, item.action),
            specValidationStatus: SpecValidationStatus.VALID,
            status: TaskStatus.PENDING,
            priority: 2,
            projectId: id,
            creatorId: session.user.id,
            assignmentMode: inferredDomain ? AssignmentMode.AI_AUTO : AssignmentMode.MANUAL,
            assigneeType: inferredDomain ? AssigneeType.FUNCTIONAL_AGENT : AssigneeType.HUMAN,
            functionalAgentType: inferredDomain
          },
          select: {
            id: true,
            title: true,
            assignmentMode: true,
            assigneeType: true,
            functionalAgentType: true,
            createdAt: true
          }
        })
      })
    )

    await db.activityLog.create({
      data: {
        projectId: id,
        userId: session.user.id,
        action: ActionType.TASK_CREATED,
        metadata: {
          type: "BOTTLENECKS_REMEDIATION_TASKS_CREATED",
          total: createdTasks.length
        }
      }
    })

    return NextResponse.json(
      {
        projectId: id,
        total: createdTasks.length,
        created: createdTasks,
        dispatchPolicyUpdate
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Create remediation tasks error:", error)
    return NextResponse.json(
      { error: "Failed to create remediation tasks", code: "REMEDIATION_TASKS_CREATE_FAILED" },
      { status: 500 }
    )
  }
}
