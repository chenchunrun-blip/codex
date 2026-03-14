import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { computeTaskRisk } from "@/lib/tasks/risk"
import { taskCreateSchema, taskSpecMarkdownSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import {
  ActionType,
  AssigneeType,
  NotificationType,
  Prisma,
  ProjectRole,
  SpecValidationStatus,
  TaskAssignmentAction,
  TaskStatus
} from "@prisma/client"
import { ZodError } from "zod"

type LatestAgentRun = {
  status: "SUCCESS" | "FAILED"
  triggeredAt: string
  executionId: string | null
  error: string | null
}

function toMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * GET /api/tasks - Get task list with filters
 * Query params: projectId, status, assigneeType
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", tasks: [], total: 0 },
        { status: 401 }
      )
    }
    const { searchParams } = new URL(req.url)

    const projectId = searchParams.get('projectId')
    const status = searchParams.get('status') as TaskStatus | null
    const assigneeType = searchParams.get('assigneeType') as AssigneeType | null
    const sourceFileId = searchParams.get('sourceFileId')
    const q = searchParams.get("q")?.trim() || ""
    const assignmentMode = searchParams.get("assignmentMode")?.trim() || ""
    const assigneeId = searchParams.get("assigneeId")?.trim() || ""
    const assigneeUnassigned = searchParams.get("assigneeUnassigned") === "1"
    const priorityRaw = searchParams.get("priority")
    const priority =
      priorityRaw === "0" || priorityRaw === "1" || priorityRaw === "2" || priorityRaw === "3"
        ? Number(priorityRaw)
        : null
    const sortBy = searchParams.get("sortBy") || "priority"
    const sortOrder: Prisma.SortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc"
    const pageRaw = searchParams.get("page")
    const limitRaw = searchParams.get("limit")
    const page = pageRaw ? Math.max(Number.parseInt(pageRaw, 10) || 1, 1) : 1
    const limit = limitRaw
      ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 20, 1), 200)
      : 20
    const usePagination = Boolean(pageRaw || limitRaw)

    // Build where clause
    const where: any = {}

    let sourceFileProjectId: string | null = null
    if (sourceFileId) {
      const file = await db.file.findUnique({
        where: { id: sourceFileId },
        select: {
          id: true,
          projectId: true
        }
      })
      if (!file) {
        return NextResponse.json(
          { error: "Source file not found", code: "SOURCE_FILE_NOT_FOUND", tasks: [], total: 0 },
          { status: 404 }
        )
      }

      const sourceMembership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: file.projectId,
            userId: session.user!.id
          }
        }
      })
      if (!sourceMembership) {
        return NextResponse.json(
          { error: "Not a project member", code: "NOT_PROJECT_MEMBER", tasks: [], total: 0 },
          { status: 403 }
        )
      }

      sourceFileProjectId = file.projectId
      const sourceTaskLogs = await db.activityLog.findMany({
        where: {
          fileId: sourceFileId,
          taskId: { not: null },
          action: ActionType.TASK_CREATED
        },
        orderBy: { createdAt: "desc" },
        select: {
          taskId: true
        }
      })
      const sourceTaskIds = Array.from(
        new Set(
          sourceTaskLogs
            .map((item) => item.taskId)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        )
      )
      if (sourceTaskIds.length === 0) {
        return NextResponse.json({
          tasks: [],
          total: 0,
          page: usePagination ? page : undefined,
          limit: usePagination ? limit : undefined,
          hasMore: false
        })
      }
      where.id = { in: sourceTaskIds }
    }

    if (projectId) {
      // Verify project access
      const membership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
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
      if (sourceFileProjectId && sourceFileProjectId !== projectId) {
        return NextResponse.json({
          tasks: [],
          total: 0,
          page: usePagination ? page : undefined,
          limit: usePagination ? limit : undefined,
          hasMore: false
        })
      }
      where.projectId = projectId
    } else if (sourceFileProjectId) {
      where.projectId = sourceFileProjectId
    } else {
      // If no projectId specified, get tasks from all user's projects
      const userProjectIds = await db.projectMember.findMany({
        where: { userId: session.user!.id },
        select: { projectId: true }
      })
      where.projectId = { in: userProjectIds.map(p => p.projectId) }
    }

    if (status) {
      where.status = status
    }

    if (assigneeType) {
      where.assigneeType = assigneeType
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } }
      ]
    }
    if (assignmentMode) {
      where.assignmentMode = assignmentMode
    }
    if (assigneeUnassigned) {
      where.assigneeId = null
    } else if (assigneeId) {
      where.assigneeId = assigneeId
    }
    if (priority !== null) {
      where.priority = priority
    }

    const orderBy =
      sortBy === "createdAt"
        ? [{ createdAt: sortOrder }]
        : sortBy === "dueDate"
          ? [{ dueDate: sortOrder }, { createdAt: "desc" as const }]
          : sortBy === "priority"
            ? [{ priority: sortOrder }, { createdAt: "desc" as const }]
            : [{ priority: "desc" as const }, { createdAt: "desc" as const }]

    const totalCount = usePagination ? await db.task.count({ where }) : 0

    const tasks = await db.task.findMany({
      where,
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
            nickname: true,
            avatar: true
          }
        },
        agent: {
          select: {
            id: true,
            name: true,
            displayName: true,
            type: true
          }
        },
        _count: {
          select: {
            deliverables: true
          }
        }
      },
      orderBy,
      ...(usePagination ? { skip: (page - 1) * limit, take: limit } : {})
    })

    const taskIds = tasks.map((task) => task.id)
    const runLogs = taskIds.length
      ? await db.activityLog.findMany({
          where: {
            taskId: { in: taskIds },
            action: ActionType.TASK_UPDATED
          },
          orderBy: { createdAt: "desc" },
          take: 1000,
          select: {
            taskId: true,
            createdAt: true,
            metadata: true
          }
        })
      : []
    const agents = await db.agent.findMany({
      where: { isActive: true },
      select: {
        capabilities: true,
        updatedAt: true
      }
    })
    const onlineAgentsByDomain = new Map<string, number>()
    for (const agent of agents) {
      if (!isAgentOnline(agent.updatedAt) || !Array.isArray(agent.capabilities)) continue
      for (const capability of agent.capabilities) {
        if (typeof capability !== "string") continue
        const domain = capability.trim().toUpperCase()
        if (!domain) continue
        onlineAgentsByDomain.set(domain, (onlineAgentsByDomain.get(domain) || 0) + 1)
      }
    }

    const latestRunByTask = new Map<string, LatestAgentRun>()
    for (const log of runLogs) {
      const taskId = log.taskId
      if (!taskId || latestRunByTask.has(taskId)) continue

      const metadata = toMetadataRecord(log.metadata)
      if (!metadata) continue

      const type = metadataString(metadata, "type")
      if (type !== "AGENT_RUN_TRIGGERED" && type !== "AGENT_RUN_FAILED") continue

      latestRunByTask.set(taskId, {
        status: type === "AGENT_RUN_FAILED" ? "FAILED" : "SUCCESS",
        triggeredAt: log.createdAt.toISOString(),
        executionId: metadataString(metadata, "executionId"),
        error: metadataString(metadata, "error")
      })
    }

    const tasksWithRuns = tasks.map((task) => ({
      ...task,
      latestAgentRun: latestRunByTask.get(task.id) || null,
      specQualityScore: task.specMarkdown ? lintTaskSpecMarkdown(task.specMarkdown).score : null
    })).map((task) => {
      const risk = computeTaskRisk({
        dueDate: task.dueDate ? new Date(task.dueDate) : null,
        latestAgentRunStatus: task.latestAgentRun?.status || null,
        specQualityScore: task.specQualityScore ?? null,
        assigneeType: task.assigneeType,
        functionalAgentType: task.functionalAgentType ?? null,
        status: task.status,
        onlineAgentsByDomain
      })

      return {
        ...task,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        riskReasons: risk.riskReasons
      }
    })

    const total = usePagination ? totalCount : tasksWithRuns.length
    return NextResponse.json({
      tasks: tasksWithRuns,
      total,
      page: usePagination ? page : undefined,
      limit: usePagination ? limit : undefined,
      hasMore: usePagination ? page * limit < total : false
    })
  } catch (error) {
    console.error("Tasks fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch tasks", code: "INTERNAL_ERROR", tasks: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tasks - Create new task
 * Requires: EDITOR+ role on project
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload", code: "INVALID_JSON" },
        { status: 400 }
      )
    }
    const parsed = taskCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          code: "INVALID_REQUEST_PAYLOAD",
          details: parsed.error.flatten()
        },
        { status: 400 }
      )
    }
    const validated = parsed.data

    // Verify project access with EDITOR role
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

    // Validate assignee
    if (validated.assigneeType === "HUMAN" && validated.assigneeId) {
      const assigneeMember = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: validated.projectId,
            userId: validated.assigneeId
          }
        }
      })
      if (!assigneeMember) {
        return NextResponse.json(
          { error: "Assignee is not a project member", code: "INVALID_ASSIGNMENT_PAYLOAD" },
          { status: 400 }
        )
      }
    }

    if (validated.assigneeType === "AGENT") {
      if (!validated.agentId) {
        return NextResponse.json(
          { error: "agentId is required for AGENT assignment", code: "INVALID_ASSIGNMENT_PAYLOAD" },
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
    }

    if (validated.assigneeType === "FUNCTIONAL_AGENT") {
      if (!validated.functionalAgentType) {
        return NextResponse.json(
          { error: "Agent queue domain is required for FUNCTIONAL_AGENT assignment (field: functionalAgentType)", code: "INVALID_ASSIGNMENT_PAYLOAD" },
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
      }
    }

    let specValidationStatus: SpecValidationStatus = SpecValidationStatus.PENDING
    let specValidationErrors: Prisma.InputJsonValue | undefined
    if (validated.specMarkdown) {
      const specCheck = taskSpecMarkdownSchema.safeParse(validated.specMarkdown)
      if (specCheck.success) {
        specValidationStatus = SpecValidationStatus.VALID
      } else {
        specValidationStatus = SpecValidationStatus.INVALID
        specValidationErrors = {
          issues: specCheck.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code
          }))
        }
      }
    }

    const task = await db.task.create({
      data: {
        title: validated.title,
        description: validated.description,
        specMarkdown: validated.specMarkdown,
        specValidationStatus,
        specValidationErrors,
        projectId: validated.projectId,
        creatorId: session.user!.id,
        assignmentMode: validated.assignmentMode ?? "MANUAL",
        assigneeType: validated.assigneeType,
        assigneeId: validated.assigneeType === "HUMAN" ? validated.assigneeId : null,
        agentId: validated.assigneeType === "HUMAN" ? null : (validated.agentId ?? null),
        functionalAgentType: validated.assigneeType === "FUNCTIONAL_AGENT"
          ? (validated.functionalAgentType ?? null)
          : null,
        priority: validated.priority ?? 2,
        dueDate: validated.dueDate ? new Date(validated.dueDate) : null
      },
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
            email: true
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
        projectId: validated.projectId,
        taskId: task.id,
        userId: session.user!.id,
        action: ActionType.TASK_CREATED,
        metadata: {
          taskTitle: task.title,
          assigneeType: task.assigneeType,
          assignmentMode: task.assignmentMode,
          specValidationStatus: task.specValidationStatus
        }
      }
    })

    if (task.assigneeId || task.agentId || task.functionalAgentType) {
      await db.taskAssignmentLog.create({
        data: {
          taskId: task.id,
          action: TaskAssignmentAction.ASSIGNED,
          actorUserId: session.user!.id,
          toType: task.assigneeType,
          toAssigneeId: task.assigneeId,
          toAgentId: task.agentId,
          metadata: {
            assignmentMode: task.assignmentMode,
            functionalAgentType: task.functionalAgentType
          }
        }
      })
    }

    // Send notification to assignee
    if (task.assigneeType === "HUMAN" && task.assigneeId) {
      await db.notification.create({
        data: {
          userId: task.assigneeId,
          type: NotificationType.TASK_ASSIGNED,
          title: "New Task Assigned",
          content: `You have been assigned to task: ${task.title}`,
          link: `/projects/${task.projectId}/tasks/${task.id}`
        }
      })
    }

    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid task payload", code: "INVALID_REQUEST_PAYLOAD", details: error.flatten() },
        { status: 400 }
      )
    }
    console.error("Task creation error:", error)
    return NextResponse.json(
      { error: "Failed to create task", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
