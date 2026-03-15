import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { pickPreferredAgent } from "@/lib/tasks/agent-selection"
import { taskAutoDispatchSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import {
  ActionType,
  AssigneeType,
  AssignmentMode,
  ProjectRole,
  TaskAssignmentAction,
  TaskStatus
} from "@prisma/client"
import { z } from "zod"

const manualAgentQueuePullSchema = taskAutoDispatchSchema
  .pick({
    projectId: true
  })
  .extend({
    functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]),
    agentId: z.string().optional(),
    claim: z.boolean().optional().default(true)
  })

/**
 * POST /api/tasks/agent-queue/manual-pull
 * Human operator queue pull for debugging/operations.
 * Requires project EDITOR+ permission.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const parsed = manualAgentQueuePullSchema.safeParse(body)
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

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: validated.projectId,
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

    let selectedAgentId: string | null = null
    if (validated.agentId) {
      const agent = await db.agent.findUnique({
        where: { id: validated.agentId },
        select: { id: true, isActive: true }
      })
      if (!agent || !agent.isActive) {
        return NextResponse.json(
          { error: "Assigned agent is not available", code: "AGENT_NOT_AVAILABLE" },
          { status: 400 }
        )
      }
      selectedAgentId = agent.id
    } else {
      const activeAgents = await db.agent.findMany({
        where: { isActive: true },
        select: {
          id: true,
          capabilities: true,
          updatedAt: true
        }
      })
      const preferred = pickPreferredAgent(activeAgents, validated.functionalAgentType)
      if (!preferred.agentId) {
        return NextResponse.json(
          { error: "No active agent available", code: "AGENT_NOT_AVAILABLE" },
          { status: 400 }
        )
      }
      selectedAgentId = preferred.agentId
    }

    const now = new Date()
    await db.agent.update({
      where: { id: selectedAgentId },
      data: { updatedAt: now }
    })

    const candidate = await db.task.findFirst({
      where: {
        projectId: validated.projectId,
        status: TaskStatus.PENDING,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        functionalAgentType: validated.functionalAgentType,
        OR: [{ agentId: null }, { agentId: selectedAgentId }]
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "asc" }],
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
        agentId: selectedAgentId,
        queueDomain: validated.functionalAgentType
      })
    }

    if (!validated.claim) {
      return NextResponse.json({
        task: candidate,
        claimed: false,
        agentId: selectedAgentId,
        queueDomain: validated.functionalAgentType
      })
    }

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
        agentId: selectedAgentId,
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

    await db.taskAssignmentLog.create({
      data: {
        taskId: claimedTask.id,
        action: TaskAssignmentAction.CLAIMED,
        actorUserId: session.user!.id,
        fromType: AssigneeType.FUNCTIONAL_AGENT,
        fromAssigneeId: null,
        fromAgentId: null,
        toType: AssigneeType.AGENT,
        toAssigneeId: null,
        toAgentId: selectedAgentId,
        reason: "Claimed by manual queue pull",
        metadata: {
          source: "manual_agent_queue_pull",
          queueDomain: validated.functionalAgentType
        }
      }
    })
    await db.activityLog.create({
      data: {
        projectId: claimedTask.projectId,
        taskId: claimedTask.id,
        userId: session.user!.id,
        action: ActionType.TASK_ASSIGNED,
        metadata: {
          source: "manual_agent_queue_pull",
          queueDomain: validated.functionalAgentType,
          agentId: selectedAgentId
        }
      }
    })

    return NextResponse.json({
      task: claimedTask,
      claimed: true,
      agentId: selectedAgentId,
      queueDomain: validated.functionalAgentType
    })
  } catch (error) {
    console.error("Manual agent queue pull error:", error)
    return NextResponse.json(
      { error: "Failed to pull task from agent queue", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
