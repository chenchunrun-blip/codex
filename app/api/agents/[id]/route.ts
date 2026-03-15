import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { agentUpdateSchema } from "@/lib/utils/validation"
import { encrypt, decrypt } from "@/lib/utils/encryption"
import { NextResponse } from "next/server"
import { ActionType, AssigneeType, FunctionalAgentType, TaskStatus, TeamRole } from "@prisma/client"

const DOMAIN_VALUES: FunctionalAgentType[] = [
  FunctionalAgentType.PRODUCT,
  FunctionalAgentType.ENGINEERING,
  FunctionalAgentType.QA,
  FunctionalAgentType.DESIGN,
  FunctionalAgentType.OPERATIONS
]

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

/**
 * GET /api/agents/[id] - Get agent details
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const agent = await db.agent.findUnique({
      where: { id },
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            projectId: true,
            project: {
              select: {
                name: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10
        },
        _count: {
          select: {
            tasks: true
          }
        }
      }
    })

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", code: "AGENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const [taskStatusRows, queueRows, allAgentTasks] = await Promise.all([
      db.task.groupBy({
        by: ["status"],
        where: { agentId: id },
        _count: { _all: true }
      }),
      db.task.groupBy({
        by: ["functionalAgentType"],
        where: {
          assigneeType: AssigneeType.FUNCTIONAL_AGENT,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
        },
        _count: { _all: true }
      }),
      db.task.findMany({
        where: { agentId: id },
        select: { id: true }
      })
    ])
    const taskIds = allAgentTasks.map((task) => task.id)
    const runLogs = taskIds.length
      ? await db.activityLog.findMany({
          where: {
            taskId: { in: taskIds },
            action: ActionType.TASK_UPDATED
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            createdAt: true,
            metadata: true
          }
        })
      : []

    const runStats = runLogs.reduce(
      (acc, item) => {
        const type = metadataType(item.metadata)
        if (type === "AGENT_RUN_TRIGGERED") acc.success += 1
        if (type === "AGENT_RUN_FAILED") acc.failed += 1
        if (!acc.lastRunAt && (type === "AGENT_RUN_TRIGGERED" || type === "AGENT_RUN_FAILED")) {
          acc.lastRunAt = item.createdAt.toISOString()
          acc.lastRunStatus = type === "AGENT_RUN_FAILED" ? "FAILED" : "SUCCESS"
        }
        return acc
      },
      {
        success: 0,
        failed: 0,
        lastRunAt: null as string | null,
        lastRunStatus: null as "SUCCESS" | "FAILED" | null
      }
    )

    const taskStatus = taskStatusRows.reduce(
      (acc, row) => {
        const count = row._count._all
        if (row.status === TaskStatus.PENDING) acc.pending = count
        if (row.status === TaskStatus.IN_PROGRESS) acc.inProgress = count
        if (row.status === TaskStatus.REVIEW) acc.review = count
        if (row.status === TaskStatus.COMPLETED) acc.completed = count
        if (row.status === TaskStatus.CANCELLED) acc.cancelled = count
        return acc
      },
      {
        pending: 0,
        inProgress: 0,
        review: 0,
        completed: 0,
        cancelled: 0
      }
    )

    const queueBacklogMap = new Map<string, number>()
    for (const row of queueRows) {
      if (!row.functionalAgentType) continue
      queueBacklogMap.set(row.functionalAgentType, row._count._all)
    }
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : []
    const domains = DOMAIN_VALUES.filter((domain) =>
      capabilities.some((item) => typeof item === "string" && item.trim().toLowerCase() === domain.toLowerCase())
    )
    const queuePressure = domains.reduce((sum, domain) => sum + (queueBacklogMap.get(domain) || 0), 0)

    // Return agent without API key
    const { apiKeyEncrypted, ...agentWithoutKey } = agent

    return NextResponse.json({
      ...agentWithoutKey,
      lastActiveAt: agent.updatedAt,
      isOnline: isAgentOnline(agent.updatedAt),
      diagnostics: {
        taskStatus,
        recentRuns: runStats,
        queuePressure: {
          domains,
          backlog: queuePressure
        }
      }
    })
  } catch (error) {
    console.error("Agent fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch agent", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/agents/[id] - Update agent config
 * Requires: Team admin role
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    // Check if user is a team admin
    const adminMembership = await db.teamMember.findFirst({
      where: {
        userId: session.user!.id,
        role: TeamRole.ADMIN
      }
    })

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Only team admins can update agents", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const agent = await db.agent.findUnique({
      where: { id }
    })

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", code: "AGENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const parsed = agentUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    // Build update data
    const updateData: any = {}
    if (validated.displayName !== undefined) updateData.displayName = validated.displayName
    if (validated.description !== undefined) updateData.description = validated.description
    if (validated.capabilities !== undefined) updateData.capabilities = validated.capabilities
    if (validated.apiEndpoint !== undefined) updateData.apiEndpoint = validated.apiEndpoint
    if (validated.modelConfig !== undefined) updateData.modelConfig = validated.modelConfig
    if (validated.systemPrompt !== undefined) updateData.systemPrompt = validated.systemPrompt
    if (validated.isActive !== undefined) updateData.isActive = validated.isActive

    // Encrypt new API key if provided
    if (body.apiKey) {
      updateData.apiKeyEncrypted = encrypt(body.apiKey)
    }

    const updatedAgent = await db.agent.update({
      where: { id },
      data: updateData
    })

    // Return without API key
    const { apiKeyEncrypted, ...agentWithoutKey } = updatedAgent

    return NextResponse.json(agentWithoutKey)
  } catch (error) {
    console.error("Agent update error:", error)
    return NextResponse.json(
      { error: "Failed to update agent", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/[id] - Delete agent
 * Requires: Team admin role
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    // Check if user is a team admin
    const adminMembership = await db.teamMember.findFirst({
      where: {
        userId: session.user!.id,
        role: TeamRole.ADMIN
      }
    })

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Only team admins can delete agents", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const agent = await db.agent.findUnique({
      where: { id },
      include: {
        tasks: {
          where: {
            status: { in: ["PENDING", "IN_PROGRESS"] }
          }
        }
      }
    })

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", code: "AGENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Check if agent has active tasks
    if (agent.tasks.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete agent with active tasks. Please reassign or complete tasks first.", code: "AGENT_HAS_ACTIVE_TASKS" },
        { status: 400 }
      )
    }

    await db.agent.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Agent deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete agent", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
