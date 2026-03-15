import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

const STARTER_LOG_TYPES = new Set([
  "TEAM_STARTER_PACK_APPLIED",
  "TEAM_TEMPLATE_ROLLOUT_APPLIED"
])

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function buildWindowSummary(
  logs: Array<{
    createdAt: Date
    metadata: unknown
  }>,
  days: number
) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  let runs = 0
  let packRuns = 0
  let templateRuns = 0
  let dryRuns = 0
  let createdTotal = 0
  let skippedTotal = 0

  for (const row of logs) {
    const ts = row.createdAt.getTime()
    if (!Number.isFinite(ts) || ts < since) continue

    const type = metadataType(row.metadata)
    if (!type || !STARTER_LOG_TYPES.has(type)) continue

    const metadata = (row.metadata || {}) as Record<string, unknown>
    runs += 1
    if (type === "TEAM_TEMPLATE_ROLLOUT_APPLIED") templateRuns += 1
    else packRuns += 1
    if (metadata.dryRun === true) dryRuns += 1
    createdTotal += asNumber(metadata.createdCount)
    skippedTotal += asNumber(metadata.skippedCount)
  }

  return {
    days,
    runs,
    packRuns,
    templateRuns,
    dryRuns,
    createdTotal,
    skippedTotal
  }
}

function buildMarkdown(input: {
  teamId: string
  summary7d: ReturnType<typeof buildWindowSummary>
  summary30d: ReturnType<typeof buildWindowSummary>
}): string {
  const lines: string[] = []
  lines.push("# Team Starter Rollout Summary")
  lines.push("")
  lines.push(`- Generated At: ${new Date().toISOString()}`)
  lines.push(`- Team ID: ${input.teamId}`)
  lines.push("")
  lines.push("## Last 7 Days")
  lines.push(`- Runs: ${input.summary7d.runs}`)
  lines.push(`- Pack Runs: ${input.summary7d.packRuns}`)
  lines.push(`- Template Runs: ${input.summary7d.templateRuns}`)
  lines.push(`- Dry Runs: ${input.summary7d.dryRuns}`)
  lines.push(`- Created: ${input.summary7d.createdTotal}`)
  lines.push(`- Skipped: ${input.summary7d.skippedTotal}`)
  lines.push("")
  lines.push("## Last 30 Days")
  lines.push(`- Runs: ${input.summary30d.runs}`)
  lines.push(`- Pack Runs: ${input.summary30d.packRuns}`)
  lines.push(`- Template Runs: ${input.summary30d.templateRuns}`)
  lines.push(`- Dry Runs: ${input.summary30d.dryRuns}`)
  lines.push(`- Created: ${input.summary30d.createdTotal}`)
  lines.push(`- Skipped: ${input.summary30d.skippedTotal}`)
  return lines.join("\n")
}

/**
 * GET /api/teams/[id]/starter-files/summary
 * Returns team rollout summary metrics for recent windows.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        {
          error: "Authentication required",
          code: "UNAUTHORIZED"
        },
        { status: 401 }
      )
    }

    const { id: teamId } = await params
    const membership = await db.teamMember.findFirst({
      where: {
        teamId,
        userId: session.user.id
      },
      select: {
        id: true
      }
    })
    if (!membership) {
      return NextResponse.json(
        {
          error: "Not a team member",
          code: "NOT_TEAM_MEMBER"
        },
        { status: 403 }
      )
    }

    const logs = await db.activityLog.findMany({
      where: {
        taskId: null,
        action: ActionType.TASK_UPDATED,
        project: {
          teamId
        }
      },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        createdAt: true,
        metadata: true
      }
    })

    const payload = {
      teamId,
      summary7d: buildWindowSummary(logs, 7),
      summary30d: buildWindowSummary(logs, 30)
    }
    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      return new Response(buildMarkdown(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }
    return NextResponse.json(payload)
  } catch (error) {
    console.error("Team starter rollout summary fetch error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch team starter rollout summary",
        code: "INTERNAL_ERROR",
        teamId: null,
        summary7d: buildWindowSummary([], 7),
        summary30d: buildWindowSummary([], 30)
      },
      { status: 500 }
    )
  }
}
