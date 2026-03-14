import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { buildTaskSpecFromFile } from "@/lib/tasks/spec-from-file"
import { taskSpecMarkdownSchema } from "@/lib/utils/validation"
import {
  ActionType,
  AssignmentMode,
  AssigneeType,
  Prisma,
  ProjectRole,
  SpecValidationStatus
} from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  skipIfLinkedTaskExists: z.boolean().optional().default(true)
})

export async function POST(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const uniqueFileIds = Array.from(new Set(parsed.data.fileIds))
    const files = await db.file.findMany({
      where: {
        id: { in: uniqueFileIds }
      },
      select: {
        id: true,
        name: true,
        content: true,
        projectId: true
      }
    })
    if (files.length === 0) {
      return NextResponse.json(
        { error: "No valid files found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    const projectIds = Array.from(new Set(files.map((file) => file.projectId)))
    const memberships = await db.projectMember.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: projectIds }
      },
      select: {
        projectId: true,
        role: true
      }
    })
    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const editableProjects = new Set(
      memberships
        .filter((item) => roleHierarchy[item.role] >= roleHierarchy[ProjectRole.EDITOR])
        .map((item) => item.projectId)
    )
    const editableFiles = files.filter((file) => editableProjects.has(file.projectId))
    if (editableFiles.length === 0) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const existingLinkedFileIds = parsed.data.skipIfLinkedTaskExists
      ? new Set(
          (
            await db.activityLog.findMany({
              where: {
                fileId: { in: editableFiles.map((file) => file.id) },
                taskId: { not: null },
                action: ActionType.TASK_CREATED
              },
              select: {
                fileId: true
              }
            })
          )
            .map((row) => row.fileId)
            .filter((value): value is string => typeof value === "string")
        )
      : new Set<string>()

    const created: Array<{ fileId: string; fileName: string; taskId: string; title: string }> = []
    const skipped: Array<{ fileId: string; fileName: string; reason: string }> = []

    for (const file of editableFiles) {
      if (existingLinkedFileIds.has(file.id)) {
        skipped.push({
          fileId: file.id,
          fileName: file.name,
          reason: "LINKED_TASK_ALREADY_EXISTS"
        })
        continue
      }

      const specMarkdown = buildTaskSpecFromFile({
        fileId: file.id,
        fileName: file.name,
        fileContent: file.content || ""
      })
      const specCheck = taskSpecMarkdownSchema.safeParse(specMarkdown)
      const specValidationStatus = specCheck.success ? SpecValidationStatus.VALID : SpecValidationStatus.INVALID
      const specValidationErrors: Prisma.InputJsonValue | undefined = specCheck.success
        ? undefined
        : {
            issues: specCheck.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
              code: issue.code
            }))
          }

      const task = await db.task.create({
        data: {
          title: `Task from ${file.name.replace(/\.md$/i, "")}`.slice(0, 200),
          description: `Created from source markdown file: ${file.name}`,
          specMarkdown,
          specValidationStatus,
          specValidationErrors,
          projectId: file.projectId,
          creatorId: session.user.id,
          assignmentMode: AssignmentMode.MANUAL,
          assigneeType: AssigneeType.HUMAN,
          assigneeId: null,
          agentId: null,
          functionalAgentType: null,
          priority: 1,
          dueDate: null
        },
        select: {
          id: true,
          title: true
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
            type: "TASK_CREATED_FROM_FILE_BULK",
            sourceFileId: file.id,
            sourceFileName: file.name
          }
        }
      })

      created.push({
        fileId: file.id,
        fileName: file.name,
        taskId: task.id,
        title: task.title
      })
    }

    return NextResponse.json(
      {
        totalRequested: uniqueFileIds.length,
        totalProcessed: editableFiles.length,
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Bulk create tasks from files error:", error)
    return NextResponse.json(
      { error: "Failed to bulk create tasks from files", code: "BULK_TASK_CREATE_FROM_FILES_FAILED" },
      { status: 500 }
    )
  }
}

