import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  teamId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  format: z.enum(["markdown"]).optional()
})

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function buildMarkdown(input: {
  teamIds: string[]
  history: Array<{
    createdAt: string
    teamId: string | null
    teamName: string | null
    projectId: string | null
    projectName: string | null
    packId: string | null
    packName: string | null
    templateId: string | null
    templateName: string | null
    templateCategory: string | null
    artifactType: "PACK" | "TEMPLATE"
    scope: string
    dryRun: boolean
    createdCount: number
    wouldCreateCount: number
    skippedCount: number
    actor: {
      id: string
      name: string | null
      email: string
    } | null
  }>
}): string {
  const lines: string[] = []
  lines.push("# Teams Starter Rollout History")
  lines.push("")
  lines.push(`- Generated At: ${new Date().toISOString()}`)
  lines.push(`- Teams: ${input.teamIds.length}`)
  lines.push(`- Records: ${input.history.length}`)
  lines.push("")
  lines.push("| Time | Team | Project | Artifact | Scope | Result | Skipped | Actor |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const item of input.history) {
    const team = item.teamName || item.teamId || "Unknown team"
    const project = item.projectName || item.projectId || "Unknown project"
    const artifact = item.packName || item.packId || item.templateName || item.templateId || "-"
    const artifactText =
      item.templateCategory && item.templateCategory.length > 0
        ? `${item.artifactType}:${artifact} (${item.templateCategory})`
        : `${item.artifactType}:${artifact}`
    const result = item.dryRun
      ? `dry-run (wouldCreate=${item.wouldCreateCount})`
      : `created=${item.createdCount}`
    const actor = item.actor?.name || item.actor?.email || "Unknown user"
    lines.push(
      `| ${item.createdAt} | ${team.replace(/\|/g, "\\|")} | ${project.replace(/\|/g, "\\|")} | ${artifactText.replace(/\|/g, "\\|")} | ${item.scope} | ${result} | ${item.skippedCount} | ${actor.replace(/\|/g, "\\|")} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/teams/starter-files/history
 * Query params: teamId, limit, format=markdown
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", history: [] },
        { status: 401 }
      )
    }

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      teamId: url.searchParams.get("teamId") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      format: url.searchParams.get("format") || undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS", history: [] },
        { status: 400 }
      )
    }

    const teamMemberships = await db.teamMember.findMany({
      where: { userId: session.user.id },
      include: {
        team: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
    const accessibleTeamIds = teamMemberships.map((item) => item.teamId)

    if (parsed.data.teamId && !accessibleTeamIds.includes(parsed.data.teamId)) {
      return NextResponse.json(
        { error: "Not a team member", code: "NOT_TEAM_MEMBER", history: [] },
        { status: 403 }
      )
    }

    const teamIds =
      parsed.data.teamId && accessibleTeamIds.includes(parsed.data.teamId)
        ? [parsed.data.teamId]
        : accessibleTeamIds

    const teamNameById = new Map(teamMemberships.map((item) => [item.teamId, item.team.name]))
    const limit = parsed.data.limit || 50

    const logs = teamIds.length
      ? await db.activityLog.findMany({
          where: {
            taskId: null,
            action: ActionType.TASK_UPDATED,
            project: {
              teamId: { in: teamIds }
            }
          },
          orderBy: { createdAt: "desc" },
          take: Math.max(limit * 3, 120),
          select: {
            createdAt: true,
            projectId: true,
            metadata: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            project: {
              select: {
                id: true,
                name: true,
                teamId: true
              }
            }
          }
        })
      : []

    const history = logs
      .filter((row) => {
        const type = metadataType(row.metadata)
        return type === "TEAM_STARTER_PACK_APPLIED" || type === "TEAM_TEMPLATE_ROLLOUT_APPLIED"
      })
      .map((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>
        const type = metadataType(row.metadata)
        const artifactType: "PACK" | "TEMPLATE" =
          type === "TEAM_TEMPLATE_ROLLOUT_APPLIED" ? "TEMPLATE" : "PACK"
        return {
          createdAt: row.createdAt.toISOString(),
          teamId: row.project?.teamId || null,
          teamName: row.project?.teamId ? teamNameById.get(row.project.teamId) || null : null,
          projectId: row.projectId,
          projectName: row.project?.name || null,
          packId: typeof metadata.packId === "string" ? metadata.packId : null,
          packName: typeof metadata.packName === "string" ? metadata.packName : null,
          templateId: typeof metadata.templateId === "string" ? metadata.templateId : null,
          templateName: typeof metadata.templateName === "string" ? metadata.templateName : null,
          templateCategory:
            typeof metadata.templateCategory === "string" ? metadata.templateCategory : null,
          artifactType,
          scope: typeof metadata.scope === "string" ? metadata.scope : "team_bulk",
          dryRun: metadata.dryRun === true,
          createdCount: typeof metadata.createdCount === "number" ? metadata.createdCount : 0,
          wouldCreateCount: typeof metadata.wouldCreateCount === "number" ? metadata.wouldCreateCount : 0,
          skippedCount: typeof metadata.skippedCount === "number" ? metadata.skippedCount : 0,
          actor: row.user
            ? {
                id: row.user.id,
                name: row.user.name,
                email: row.user.email
              }
            : null
        }
      })
      .slice(0, limit)

    const payload = {
      teamIds,
      history
    }

    if (parsed.data.format === "markdown") {
      return new Response(buildMarkdown(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Teams starter history fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch teams starter history", code: "INTERNAL_ERROR", history: [] },
      { status: 500 }
    )
  }
}
