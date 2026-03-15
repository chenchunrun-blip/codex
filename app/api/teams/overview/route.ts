import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

type TeamOverviewItem = {
  id: string
  name: string
  description: string | null
  memberCount: number
  projectCount: number
  starterRuns7d: number
  createdAt: string
}

function buildTeamsOverviewMarkdown(input: { generatedAt: Date; teams: TeamOverviewItem[] }) {
  const lines: string[] = []
  lines.push("# Teams Overview Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Teams: ${input.teams.length}`)
  lines.push("")
  lines.push("| Team | Description | Members | Projects | Starter Rollouts (7d) | Created At |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const team of input.teams) {
    lines.push(
      `| ${team.name.replace(/\|/g, "\\|")} | ${(team.description || "").replace(/\|/g, "\\|")} | ${team.memberCount} | ${team.projectCount} | ${team.starterRuns7d} | ${new Date(team.createdAt).toISOString()} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/teams/overview
 * Query:
 * - format=markdown => text/markdown response
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
      take: 300
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
            take: 5000
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

    const generatedAt = new Date()
    const items: TeamOverviewItem[] = teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      memberCount: team._count.members,
      projectCount: team._count.projects,
      starterRuns7d: starterRuns7dMap.get(team.id) || 0,
      createdAt: team.createdAt.toISOString()
    }))

    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      const markdown = buildTeamsOverviewMarkdown({ generatedAt, teams: items })
      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json({
      generatedAt: generatedAt.toISOString(),
      total: items.length,
      teams: items
    })
  } catch (error) {
    console.error("Teams overview route error:", error)
    return NextResponse.json(
      { error: "Failed to load teams overview", code: "TEAMS_OVERVIEW_FAILED" },
      { status: 500 }
    )
  }
}
