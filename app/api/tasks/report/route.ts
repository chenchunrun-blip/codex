import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { TaskStatus } from "@prisma/client"
import { z } from "zod"

const querySchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceProjectId: z.string().min(1).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  format: z.enum(["markdown"]).optional()
})

function formatAssigneeType(value: string): string {
  if (value === "FUNCTIONAL_AGENT") return "AGENT_QUEUE"
  return value
}

function buildTasksReportMarkdown(input: {
  generatedAt: Date
  sourceProjectIds: string[]
  status?: string
  tasks: Array<{
    id: string
    title: string
    status: string
    priority: number
    assigneeType: string
    functionalAgentType: string | null
    dueDate: Date | null
    project: { id: string; name: string }
  }>
}) {
  const lines: string[] = []
  lines.push("# Tasks Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Source Projects: ${input.sourceProjectIds.length}`)
  lines.push(`- Tasks: ${input.tasks.length}`)
  if (input.status) {
    lines.push(`- Status Filter: ${input.status}`)
  }
  lines.push("")
  lines.push("| Task | Project | Status | Priority | Assignee Type | Queue Domain | Due Date |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const task of input.tasks) {
    lines.push(
      `| ${task.title.replace(/\|/g, "\\|")} | ${task.project.name.replace(/\|/g, "\\|")} | ${task.status} | ${task.priority} | ${formatAssigneeType(task.assigneeType)} | ${task.functionalAgentType || "-"} | ${task.dueDate ? task.dueDate.toISOString() : "-"} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/tasks/report
 * Query params: projectId, sourceProjectId, status, format=markdown
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      projectId: url.searchParams.get("projectId") || undefined,
      sourceProjectId: url.searchParams.get("sourceProjectId") || undefined,
      status: url.searchParams.get("status") || undefined,
      format: url.searchParams.get("format") || undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: {
        projectId: true
      }
    })
    const accessibleProjectIds = new Set(memberships.map((item) => item.projectId))
    if (accessibleProjectIds.size === 0) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        total: 0,
        tasks: [],
        sourceProjectIds: []
      })
    }

    const scopedProjectId = parsed.data.sourceProjectId || parsed.data.projectId
    if (scopedProjectId && !accessibleProjectIds.has(scopedProjectId)) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }
    const sourceProjectIds = scopedProjectId ? [scopedProjectId] : Array.from(accessibleProjectIds)

    const tasks = await db.task.findMany({
      where: {
        projectId: { in: sourceProjectIds },
        ...(parsed.data.status ? { status: parsed.data.status } : {})
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

    const generatedAt = new Date()
    if (parsed.data.format === "markdown") {
      const markdown = buildTasksReportMarkdown({
        generatedAt,
        sourceProjectIds,
        status: parsed.data.status,
        tasks
      })
      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    const statusCounts = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1
      return acc
    }, {})

    const assigneeCounts = tasks.reduce<Record<string, number>>((acc, task) => {
      const key = formatAssigneeType(task.assigneeType)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return NextResponse.json({
      generatedAt: generatedAt.toISOString(),
      total: tasks.length,
      sourceProjectIds,
      statusFilter: parsed.data.status || null,
      statusCounts,
      assigneeCounts,
      tasks: tasks.map((task) => ({
        ...task,
        assigneeType: formatAssigneeType(task.assigneeType)
      }))
    })
  } catch (error) {
    console.error("Tasks report route error:", error)
    return NextResponse.json(
      { error: "Failed to fetch tasks report", code: "TASKS_REPORT_FAILED" },
      { status: 500 }
    )
  }
}
