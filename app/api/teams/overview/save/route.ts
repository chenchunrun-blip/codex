import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/teams/overview/save
 * Save teams overview report into a project markdown file.
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

    const teams = await db.team.findMany({
      where: {
        members: {
          some: { userId: session.user.id }
        }
      },
      include: {
        projects: {
          select: {
            id: true
          }
        },
        _count: {
          select: {
            members: true,
            projects: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    })
    const projectIdToTeamId = new Map<string, string>()
    for (const team of teams) {
      for (const project of team.projects) {
        projectIdToTeamId.set(project.id, team.id)
      }
    }
    const starterRuns7dMap = new Map<string, number>()
    const starterActivityLogs =
      projectIdToTeamId.size > 0
        ? await db.activityLog.findMany({
            where: {
              action: ActionType.TASK_UPDATED,
              projectId: { in: Array.from(projectIdToTeamId.keys()) },
              createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              }
            },
            select: {
              projectId: true,
              metadata: true
            },
            orderBy: {
              createdAt: "desc"
            },
            take: 3000
          })
        : []
    for (const log of starterActivityLogs) {
      const metadata =
        log.metadata && typeof log.metadata === "object" ? (log.metadata as Record<string, unknown>) : null
      const type = typeof metadata?.type === "string" ? metadata.type : null
      if (
        type !== "TEAM_STARTER_PACK_APPLIED" &&
        type !== "TEAM_TEMPLATE_ROLLOUT" &&
        type !== "PROJECT_STARTER_PACK_APPLIED" &&
        type !== "PROJECT_TEMPLATE_ROLLOUT"
      ) {
        continue
      }
      if (!log.projectId) continue
      const teamId = projectIdToTeamId.get(log.projectId)
      if (!teamId) continue
      starterRuns7dMap.set(teamId, (starterRuns7dMap.get(teamId) || 0) + 1)
    }

    const lines: string[] = []
    lines.push("# Teams Overview Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Teams: ${teams.length}`)
    lines.push("")
    lines.push("| Team | Description | Members | Projects | Starter Rollouts (7d) | Created At |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const team of teams) {
      lines.push(
        `| ${team.name.replace(/\|/g, "\\|")} | ${(team.description || "").replace(/\|/g, "\\|")} | ${team._count.members} | ${team._count.projects} | ${starterRuns7dMap.get(team.id) || 0} | ${team.createdAt.toISOString()} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `teams-overview-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TEAMS_OVERVIEW_REPORT",
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
          type: "TEAMS_OVERVIEW_REPORT_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Teams overview report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save teams overview report error:", error)
    return NextResponse.json(
      { error: "Failed to save teams overview report", code: "TEAMS_OVERVIEW_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
