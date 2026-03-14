import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, AssigneeType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function formatTaskStatusRows(items: Array<{ status: string; _count: number }>): string {
  if (items.length === 0) return "- No tasks yet"
  return items.map((item) => `- ${item.status}: ${item._count}`).join("\n")
}

function formatQueueRows(
  items: Array<{ functionalAgentType: string | null; _count: number }>
): string {
  if (items.length === 0) return "- No active agent queue backlog"
  return items
    .map((item) => `- ${item.functionalAgentType || "UNSPECIFIED"}: ${item._count}`)
    .join("\n")
}

function formatRecentRunsRows(
  rows: Array<{
    createdAt: Date
    taskTitle: string
    status: "SUCCESS" | "FAILED"
    runtimeMode: string | null
    error: string | null
  }>
): string {
  if (rows.length === 0) return "- No agent runs yet"
  return rows
    .map((row) => {
      const runtime = row.runtimeMode ? ` | runtime=${row.runtimeMode}` : ""
      const error = row.error ? ` | error=${row.error}` : ""
      return `- ${row.createdAt.toISOString()} | ${row.taskTitle} | ${row.status}${runtime}${error}`
    })
    .join("\n")
}

function formatHighRiskRows(
  rows: Array<{
    id: string
    title: string
    status: string
    dueDate: Date | null
  }>
): string {
  if (rows.length === 0) return "- No high-risk tasks in next 3 days"
  return rows
    .map(
      (row) =>
        `- ${row.title} (${row.id}) | status=${row.status}${row.dueDate ? ` | due=${row.dueDate.toISOString()}` : ""}`
    )
    .join("\n")
}

function buildWorkspaceMarkdown(input: {
  project: {
    id: string
    name: string
    status: string
    teamName: string
    members: number
    files: number
  }
  activeAgents: number
  taskStatusRows: Array<{ status: string; _count: number }>
  queueRows: Array<{ functionalAgentType: string | null; _count: number }>
  dispatchRows: Array<{
    createdAt: Date
    successCount: number
    failedCount: number
    triggerMode: string
  }>
  recentRuns: Array<{
    createdAt: Date
    taskTitle: string
    status: "SUCCESS" | "FAILED"
    runtimeMode: string | null
    error: string | null
  }>
  highRiskTasks: Array<{
    id: string
    title: string
    status: string
    dueDate: Date | null
  }>
  generatedAt: Date
}) {
  return `# Workspace Report - ${input.project.name}

## Project
- Project ID: ${input.project.id}
- Team: ${input.project.teamName}
- Status: ${input.project.status}
- Members: ${input.project.members}
- Files: ${input.project.files}
- Active Agents: ${input.activeAgents}
- Generated At: ${input.generatedAt.toISOString()}

## Task Status
${formatTaskStatusRows(input.taskStatusRows)}

## Agent Queue Backlog
${formatQueueRows(input.queueRows)}

## Recent Auto Dispatch Batches
${input.dispatchRows.length > 0
    ? input.dispatchRows
        .map(
          (row) =>
            `- ${row.createdAt.toISOString()} | mode=${row.triggerMode} | success=${row.successCount} | failed=${row.failedCount}`
        )
        .join("\n")
    : "- No auto-dispatch batches yet"}

## Recent Agent Runs
${formatRecentRunsRows(input.recentRuns)}

## High Risk Tasks (Due <= 3 days)
${formatHighRiskRows(input.highRiskTasks)}
`
}

/**
 * POST /api/projects/[id]/workspace-report/save
 * Persist current workspace report as a markdown file in project.
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

    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        team: { select: { name: true } },
        _count: { select: { files: true, members: true } }
      }
    })
    if (!project) {
      return NextResponse.json(
        { error: "Project not found", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const next3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const [taskStatusRows, queueRows, activeAgentCount, dispatchLogs, runLogs, highRiskTasks] = await Promise.all([
      db.task.groupBy({
        by: ["status"],
        where: { projectId: id },
        _count: { _all: true }
      }),
      db.task.groupBy({
        by: ["functionalAgentType"],
        where: {
          projectId: id,
          assigneeType: AssigneeType.FUNCTIONAL_AGENT,
          status: { in: ["PENDING", "IN_PROGRESS"] }
        },
        _count: { _all: true }
      }),
      db.agent.count({ where: { isActive: true } }),
      db.activityLog.findMany({
        where: {
          projectId: id,
          taskId: null,
          action: ActionType.TASK_UPDATED
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          createdAt: true,
          metadata: true
        }
      }),
      db.activityLog.findMany({
        where: {
          projectId: id,
          taskId: { not: null },
          action: ActionType.TASK_UPDATED
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          taskId: true,
          createdAt: true,
          metadata: true
        }
      }),
      db.task.findMany({
        where: {
          projectId: id,
          status: { in: ["PENDING", "IN_PROGRESS", "REVIEW"] },
          dueDate: { lte: next3Days }
        },
        orderBy: { dueDate: "asc" },
        take: 10,
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true
        }
      })
    ])

    const normalizedTaskRows = taskStatusRows.map((item) => ({
      status: item.status,
      _count: item._count._all
    }))
    const normalizedQueueRows = queueRows.map((item) => ({
      functionalAgentType: item.functionalAgentType,
      _count: item._count._all
    }))
    const dispatchRows = dispatchLogs
      .filter((item) => getMetadataType(item.metadata) === "AGENT_AUTO_DISPATCH_BATCH_COMPLETED")
      .slice(0, 5)
      .map((item) => {
        const m = (item.metadata || {}) as Record<string, unknown>
        return {
          createdAt: item.createdAt,
          successCount: typeof m.successCount === "number" ? m.successCount : 0,
          failedCount: typeof m.failedCount === "number" ? m.failedCount : 0,
          triggerMode: typeof m.triggerMode === "string" ? m.triggerMode : "MANUAL"
        }
      })
    const taskIds = Array.from(
      new Set(
        runLogs
          .map((log) => log.taskId)
          .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0)
      )
    )
    const relatedTasks = taskIds.length
      ? await db.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true }
        })
      : []
    const taskTitleMap = new Map(relatedTasks.map((task) => [task.id, task.title]))
    const recentRuns = runLogs
      .map((item) => {
        const metadata = (item.metadata || {}) as Record<string, unknown>
        const type = getMetadataType(metadata)
        if (type !== "AGENT_RUN_TRIGGERED" && type !== "AGENT_RUN_FAILED") return null
        return {
          createdAt: item.createdAt,
          taskTitle: taskTitleMap.get(item.taskId || "") || `Task(${item.taskId})`,
          status: type === "AGENT_RUN_FAILED" ? ("FAILED" as const) : ("SUCCESS" as const),
          runtimeMode: typeof metadata.runtimeMode === "string" ? metadata.runtimeMode : null,
          error: typeof metadata.error === "string" ? metadata.error : null
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 10)

    const generatedAt = new Date()
    const markdown = buildWorkspaceMarkdown({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        teamName: project.team.name,
        members: project._count.members,
        files: project._count.files
      },
      activeAgents: activeAgentCount,
      taskStatusRows: normalizedTaskRows,
      queueRows: normalizedQueueRows,
      dispatchRows,
      recentRuns,
      highRiskTasks,
      generatedAt
    })

    const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-")
    const fileName = `workspace-report-${timestamp}.md`
    const storageId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

    const file = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: project.name,
        templateType: "WORKSPACE_REPORT",
        creatorId: session.user.id,
        projectId: project.id,
        storageId
      },
      select: {
        id: true,
        name: true,
        createdAt: true
      }
    })

    await db.activityLog.create({
      data: {
        projectId: project.id,
        fileId: file.id,
        userId: session.user.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "WORKSPACE_REPORT_FILE_CREATED",
          generatedAt: generatedAt.toISOString()
        }
      }
    })

    return NextResponse.json(
      {
        file,
        generatedAt: generatedAt.toISOString()
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Save workspace report file error:", error)
    return NextResponse.json(
      { error: "Failed to save workspace report file", code: "WORKSPACE_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
