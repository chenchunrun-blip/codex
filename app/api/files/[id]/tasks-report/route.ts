import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

type LinkedTaskRow = {
  id: string
  title: string
  status: string
  assignmentMode: string
  assigneeType: string
  createdAt: Date
}

function formatAssigneeType(value: string): string {
  if (value === "FUNCTIONAL_AGENT") return "AGENT_QUEUE"
  return value
}

function buildTasksReportMarkdown(input: {
  file: { id: string; name: string; projectId: string }
  generatedAt: Date
  tasks: LinkedTaskRow[]
}): string {
  const statusCounts = new Map<string, number>()
  for (const item of input.tasks) {
    statusCounts.set(item.status, (statusCounts.get(item.status) || 0) + 1)
  }
  const statusLines =
    Array.from(statusCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([status, count]) => `- ${status}: ${count}`)
      .join("\n") || "- No linked tasks"

  const taskLines =
    input.tasks.length > 0
      ? input.tasks
          .map(
            (task, index) =>
              `${index + 1}. [${task.title}](/tasks/${task.id}) | status=${task.status} | mode=${task.assignmentMode} | assigneeType=${formatAssigneeType(task.assigneeType)} | linkedAt=${task.createdAt.toISOString()}`
          )
          .join("\n")
      : "No linked tasks found."

  return `# Linked Tasks Report - ${input.file.name}

## Source File
- File Name: ${input.file.name}
- File ID: ${input.file.id}
- Project ID: ${input.file.projectId}
- Generated At: ${input.generatedAt.toISOString()}

## Linked Task Summary
- Total Linked Tasks: ${input.tasks.length}

### Status Breakdown
${statusLines}

## Linked Tasks
${taskLines}
`
}

/**
 * GET /api/files/[id]/tasks-report
 * Query:
 * - format=markdown => text/markdown response
 */
export async function GET(
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
    const file = await db.file.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
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
    const tasks: LinkedTaskRow[] = creationLogs
      .filter((row) => {
        if (!row.taskId || unique.has(row.taskId) || !row.task) return false
        unique.add(row.taskId)
        return true
      })
      .map((row) => ({
        id: row.task!.id,
        title: row.task!.title,
        status: row.task!.status,
        assignmentMode: row.task!.assignmentMode,
        assigneeType: row.task!.assigneeType,
        createdAt: row.createdAt
      }))

    const generatedAt = new Date()
    const markdown = buildTasksReportMarkdown({
      file,
      generatedAt,
      tasks
    })

    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json({
      file,
      generatedAt: generatedAt.toISOString(),
      total: tasks.length,
      tasks,
      markdown
    })
  } catch (error) {
    console.error("File tasks report error:", error)
    return NextResponse.json(
      { error: "Failed to generate file tasks report", code: "FILE_TASKS_REPORT_FAILED" },
      { status: 500 }
    )
  }
}
