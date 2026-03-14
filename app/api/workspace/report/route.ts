import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function buildMarkdown(input: {
  generatedAt: string
  userId: string
  summary: {
    teams: number
    projects: number
    files: number
    activeAgents: number
    onlineAgents: number
  }
  statusRows: Array<{ status: string; count: number }>
  recentProjects: Array<{ id: string; name: string; teamName: string; updatedAt: string }>
  recentDispatch: Array<{ createdAt: string; projectId: string | null; success: number; failed: number }>
}) {
  const taskStatusRows =
    input.statusRows.length === 0
      ? "- No tasks yet"
      : input.statusRows.map((row) => `- ${row.status}: ${row.count}`).join("\n")
  const projectRows =
    input.recentProjects.length === 0
      ? "- No projects yet"
      : input.recentProjects
          .map((project) => `- ${project.name} (${project.teamName}) · updated ${project.updatedAt}`)
          .join("\n")
  const dispatchRows =
    input.recentDispatch.length === 0
      ? "- No dispatch records"
      : input.recentDispatch
          .map(
            (row) =>
              `- ${row.createdAt} · project=${row.projectId || "N/A"} · success=${row.success} · failed=${row.failed}`
          )
          .join("\n")

  return `# Workspace Report

- Generated At: ${input.generatedAt}
- User ID: ${input.userId}
- Teams: ${input.summary.teams}
- Projects: ${input.summary.projects}
- Files: ${input.summary.files}
- Active Agents: ${input.summary.activeAgents}
- Online Agents: ${input.summary.onlineAgents}

## Task Status
${taskStatusRows}

## Recent Projects
${projectRows}

## Recent Auto Dispatch
${dispatchRows}
`
}

/**
 * GET /api/workspace/report
 * Query:
 * - format=markdown => returns text/markdown
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

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: { projectId: true }
    })
    const projectIds = Array.from(new Set(memberships.map((item) => item.projectId)))

    const [teamCount, projects, fileCount, taskStatus, agents, dispatchLogs] = await Promise.all([
      db.team.count({
        where: {
          members: {
            some: { userId: session.user.id }
          }
        }
      }),
      db.project.findMany({
        where: {
          id: { in: projectIds }
        },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          team: {
            select: {
              name: true
            }
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 10
      }),
      db.file.count({
        where: {
          projectId: { in: projectIds }
        }
      }),
      projectIds.length
        ? db.task.groupBy({
            by: ["status"],
            where: {
              projectId: { in: projectIds }
            },
            _count: { _all: true }
          })
        : Promise.resolve([]),
      db.agent.findMany({
        where: { isActive: true },
        select: {
          id: true,
          updatedAt: true
        }
      }),
      projectIds.length
        ? db.activityLog.findMany({
            where: {
              projectId: { in: projectIds },
              taskId: null,
              action: ActionType.TASK_UPDATED
            },
            orderBy: { createdAt: "desc" },
            take: 60,
            select: {
              createdAt: true,
              projectId: true,
              metadata: true
            }
          })
        : Promise.resolve([])
    ])

    const now = Date.now()
    const onlineAgents = agents.filter((agent) => now - agent.updatedAt.getTime() <= 5 * 60 * 1000).length
    const statusRows = taskStatus.map((row) => ({
      status: row.status,
      count: row._count._all
    }))
    const recentDispatch = dispatchLogs
      .filter((row) => metadataType(row.metadata) === "AGENT_AUTO_DISPATCH_BATCH_COMPLETED")
      .slice(0, 10)
      .map((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>
        return {
          createdAt: row.createdAt.toISOString(),
          projectId: row.projectId || null,
          success: typeof metadata.successCount === "number" ? metadata.successCount : 0,
          failed: typeof metadata.failedCount === "number" ? metadata.failedCount : 0
        }
      })

    const payload = {
      generatedAt: new Date().toISOString(),
      userId: session.user.id,
      summary: {
        teams: teamCount,
        projects: projectIds.length,
        files: fileCount,
        activeAgents: agents.length,
        onlineAgents
      },
      statusRows,
      recentProjects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        teamName: project.team.name,
        updatedAt: project.updatedAt.toISOString()
      })),
      recentDispatch
    }
    const markdown = buildMarkdown(payload)
    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      return new Response(markdown, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" }
      })
    }

    return NextResponse.json({
      ...payload,
      taskStatus: statusRows,
      markdown
    })
  } catch (error) {
    console.error("Workspace report route error:", error)
    return NextResponse.json(
      { error: "Failed to generate workspace report", code: "WORKSPACE_REPORT_FAILED" },
      { status: 500 }
    )
  }
}
