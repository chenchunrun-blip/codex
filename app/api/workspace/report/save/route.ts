import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

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
 * POST /api/workspace/report/save
 * Save current workspace report as markdown file in a project.
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `workspace-report-${timestamp}.md`

    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "WORKSPACE_REPORT",
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
          type: "WORKSPACE_REPORT_SAVED",
          source: "workspace",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Workspace report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save workspace report error:", error)
    return NextResponse.json(
      { error: "Failed to save workspace report", code: "WORKSPACE_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
