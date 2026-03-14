import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { resolveProjectDispatchPolicy } from "@/lib/tasks/dispatch-policy"
import { resolveProjectBottlenecks } from "@/lib/tasks/project-bottlenecks"
import { ActionType, AssigneeType } from "@prisma/client"
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

function formatAtRiskDomainRows(
  rows: Array<{ domain: string; backlog: number; onlineAgents: number }>
): string {
  if (rows.length === 0) return "- None"
  return rows.map((row) => `- ${row.domain}: backlog=${row.backlog}, onlineAgents=${row.onlineAgents}`).join("\n")
}

function formatRecommendationRows(
  rows: Array<{ type: "QUEUE" | "TASK"; title: string; action: string }>
): string {
  if (rows.length === 0) return "- None"
  return rows.map((row) => `- [${row.type}] ${row.title}. Action: ${row.action}`).join("\n")
}

/**
 * GET /api/projects/[id]/workspace-report
 * Query:
 * - format=markdown -> text/markdown response
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
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user.id
        }
      },
      select: { role: true }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        team: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            files: true,
            members: true
          }
        }
      }
    })
    if (!project) {
      return NextResponse.json(
        { error: "Project not found", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const next3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const [taskStatusRows, queueRows, activeAgentCount, dispatchLogs, runLogs, highRiskTasks, dispatchPolicy, bottlenecks] = await Promise.all([
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
      db.agent.count({
        where: { isActive: true }
      }),
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
      }),
      resolveProjectDispatchPolicy(id),
      resolveProjectBottlenecks(id)
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
        const successCount = typeof m.successCount === "number" ? m.successCount : 0
        const failedCount = typeof m.failedCount === "number" ? m.failedCount : 0
        const triggerMode = typeof m.triggerMode === "string" ? m.triggerMode : "MANUAL"
        return {
          createdAt: item.createdAt,
          successCount,
          failedCount,
          triggerMode
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
    const markdown = `# Workspace Report - ${project.name}

## Project
- Project ID: ${project.id}
- Team: ${project.team.name}
- Status: ${project.status}
- Members: ${project._count.members}
- Files: ${project._count.files}
- Active Agents: ${activeAgentCount}
- Generated At: ${generatedAt.toISOString()}

## Task Status
${formatTaskStatusRows(normalizedTaskRows)}

## Agent Queue Backlog
${formatQueueRows(normalizedQueueRows)}

## Agent Dispatch Policy
- onlineOnly: ${dispatchPolicy.onlineOnly ? "true" : "false"}
- source: ${dispatchPolicy.source}
- updatedAt: ${dispatchPolicy.updatedAt || "N/A"}

## At-Risk Queue Domains
${formatAtRiskDomainRows(bottlenecks.atRiskDomains)}

## Bottleneck Recommendations
${formatRecommendationRows(bottlenecks.recommendations)}

## Recent Auto Dispatch Batches
${dispatchRows.length > 0
    ? dispatchRows
        .map(
          (row) =>
            `- ${row.createdAt.toISOString()} | mode=${row.triggerMode} | success=${row.successCount} | failed=${row.failedCount}`
        )
        .join("\n")
    : "- No auto-dispatch batches yet"}

## Recent Agent Runs
${formatRecentRunsRows(recentRuns)}

## High Risk Tasks (Due <= 3 days)
${formatHighRiskRows(highRiskTasks)}
`

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
      project: {
        id: project.id,
        name: project.name,
        status: project.status
      },
      generatedAt: generatedAt.toISOString(),
      markdown,
      metrics: {
        members: project._count.members,
        files: project._count.files,
        activeAgents: activeAgentCount,
        dispatchPolicy,
        taskStatus: normalizedTaskRows,
        queueBacklog: normalizedQueueRows,
        atRiskDomains: bottlenecks.atRiskDomains,
        bottleneckRecommendations: bottlenecks.recommendations,
        dispatchHistory: dispatchRows,
        recentAgentRuns: recentRuns,
        highRiskTasks
      }
    })
  } catch (error) {
    console.error("Workspace report error:", error)
    return NextResponse.json(
      { error: "Failed to generate workspace report", code: "WORKSPACE_REPORT_FAILED" },
      { status: 500 }
    )
  }
}
