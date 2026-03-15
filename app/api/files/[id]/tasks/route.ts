import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { buildTaskSpecFromFile } from "@/lib/tasks/spec-from-file"
import { taskCreateSchema, taskSpecMarkdownSchema } from "@/lib/utils/validation"
import {
  ActionType,
  AssigneeType,
  Prisma,
  ProjectRole,
  SpecValidationStatus
} from "@prisma/client"
import { NextResponse } from "next/server"

/**
 * GET /api/files/[id]/tasks
 * List tasks created from the source markdown file.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", tasks: [] },
        { status: 401 }
      )
    }

    const { id } = await params
    const file = await db.file.findUnique({
      where: { id },
      select: { id: true, name: true, projectId: true }
    })
    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND", tasks: [] },
        { status: 404 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: file.projectId,
          userId: session.user.id
        }
      }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER", tasks: [] },
        { status: 403 }
      )
    }

    const creationLogs = await db.activityLog.findMany({
      where: {
        fileId: file.id,
        taskId: { not: null },
        action: ActionType.TASK_CREATED
      },
      orderBy: { createdAt: "desc" },
      select: {
        taskId: true,
        createdAt: true,
        metadata: true,
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            assignmentMode: true,
            assigneeType: true
          }
        }
      }
    })

    const unique = new Set<string>()
    const tasks = creationLogs
      .filter((item) => {
        if (!item.taskId || unique.has(item.taskId)) return false
        unique.add(item.taskId)
        return true
      })
      .map((item) => ({
        taskId: item.taskId,
        createdAt: item.createdAt,
        task: item.task
      }))

    return NextResponse.json({
      file: { id: file.id, name: file.name },
      tasks
    })
  } catch (error) {
    console.error("List tasks from file error:", error)
    return NextResponse.json(
      { error: "Failed to list tasks for file", code: "FILE_TASK_LIST_FAILED", tasks: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/files/[id]/tasks
 * Create a task from a markdown file context.
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

    const file = await db.file.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        content: true,
        projectId: true
      }
    })
    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: file.projectId,
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

    const fallbackTitle = `Task from ${file.name.replace(/\.md$/i, "")}`
    const generatedSpec = buildTaskSpecFromFile({
      fileId: file.id,
      fileName: file.name,
      fileContent: file.content || ""
    })

    const parsed = taskCreateSchema.safeParse({
      title: body.title || fallbackTitle,
      description: body.description || `Created from source markdown file: ${file.name}`,
      assignmentMode: body.assignmentMode,
      assigneeType: body.assigneeType,
      assigneeId: body.assigneeId,
      agentId: body.agentId,
      functionalAgentType: body.functionalAgentType,
      priority: body.priority,
      dueDate: body.dueDate,
      projectId: file.projectId,
      specMarkdown: body.specMarkdown || generatedSpec
    })
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

    if (validated.assigneeType === AssigneeType.HUMAN && validated.assigneeId) {
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
    if (validated.assigneeType === AssigneeType.AGENT && validated.agentId) {
      const agent = await db.agent.findUnique({
        where: { id: validated.agentId },
        select: { id: true, isActive: true }
      })
      if (!agent || !agent.isActive) {
        return NextResponse.json(
          { error: "Agent not found or inactive", code: "INVALID_ASSIGNMENT_PAYLOAD" },
          { status: 400 }
        )
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
        creatorId: session.user.id,
        assignmentMode: validated.assignmentMode ?? "MANUAL",
        assigneeType: validated.assigneeType,
        assigneeId: validated.assigneeType === AssigneeType.HUMAN ? validated.assigneeId ?? null : null,
        agentId: validated.assigneeType === AssigneeType.HUMAN ? null : validated.agentId ?? null,
        functionalAgentType:
          validated.assigneeType === AssigneeType.FUNCTIONAL_AGENT
            ? validated.functionalAgentType ?? null
            : null,
        priority: validated.priority,
        dueDate: validated.dueDate ? new Date(validated.dueDate) : null
      }
    })

    await db.activityLog.create({
      data: {
        projectId: file.projectId,
        taskId: task.id,
        fileId: file.id,
        userId: session.user.id,
        action: ActionType.TASK_CREATED,
        metadata: {
          type: "TASK_CREATED_FROM_FILE",
          sourceFileId: file.id,
          sourceFileName: file.name,
          generatedSpec: !body.specMarkdown
        }
      }
    })

    return NextResponse.json(
      {
        task,
        source: {
          fileId: file.id,
          fileName: file.name
        }
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Create task from file error:", error)
    return NextResponse.json(
      { error: "Failed to create task from file", code: "TASK_CREATE_FROM_FILE_FAILED" },
      { status: 500 }
    )
  }
}
