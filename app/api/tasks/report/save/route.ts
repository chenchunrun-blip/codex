import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceProjectId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

function formatAssigneeType(value: string): string {
  if (value === "FUNCTIONAL_AGENT") return "AGENT_QUEUE"
  return value
}

/**
 * POST /api/tasks/report/save
 * Save task report markdown into a project file.
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

    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            updatedAt: true
          }
        }
      },
      orderBy: {
        project: {
          updatedAt: "desc"
        }
      }
    })
    if (memberships.length === 0) {
      return NextResponse.json(
        { error: "No project membership found", code: "NO_PROJECT_MEMBERSHIP" },
        { status: 400 }
      )
    }

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const targetMembership = parsed.data.projectId
      ? memberships.find((item) => item.projectId === parsed.data.projectId)
      : memberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found in your memberships", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (roleHierarchy[targetMembership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const accessibleProjectIds = new Set(memberships.map((item) => item.projectId))
    const sourceProjectIds =
      parsed.data.sourceProjectId && accessibleProjectIds.has(parsed.data.sourceProjectId)
        ? [parsed.data.sourceProjectId]
        : Array.from(accessibleProjectIds)

    const tasks = await db.task.findMany({
      where: {
        projectId: { in: sourceProjectIds },
        ...(parsed.data.status ? { status: parsed.data.status as any } : {})
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        assigneeType: true,
        functionalAgentType: true,
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 500
    })

    const lines: string[] = []
    lines.push("# Tasks Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Source Projects: ${sourceProjectIds.length}`)
    lines.push(`- Tasks: ${tasks.length}`)
    if (parsed.data.status) {
      lines.push(`- Status Filter: ${parsed.data.status}`)
    }
    lines.push("")
    lines.push("| Task | Project | Status | Priority | Assignee Type | Queue Domain | Due Date |")
    lines.push("| --- | --- | --- | --- | --- | --- | --- |")
    for (const task of tasks) {
      lines.push(
        `| ${task.title.replace(/\|/g, "\\|")} | ${task.project.name.replace(/\|/g, "\\|")} | ${task.status} | ${task.priority} | ${formatAssigneeType(task.assigneeType)} | ${task.functionalAgentType || "-"} | ${task.dueDate ? task.dueDate.toISOString() : "-"} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `tasks-report-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TASKS_REPORT",
        creatorId: session.user.id,
        projectId: targetMembership.project.id,
        storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
      },
      select: {
        id: true,
        name: true,
        projectId: true,
        createdAt: true
      }
    })
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        projectId: targetMembership.project.id,
        fileId: reportFile.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "TASKS_REPORT_SAVED",
          fileName: reportFile.name,
          statusFilter: parsed.data.status || null
        }
      }
    })

    return NextResponse.json({
      message: "Tasks report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save tasks report error:", error)
    return NextResponse.json(
      { error: "Failed to save tasks report", code: "TASKS_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
