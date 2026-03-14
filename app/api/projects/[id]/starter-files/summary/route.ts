import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

const STARTER_LOG_TYPES = new Set([
  "PROJECT_STARTER_PACK_APPLIED",
  "PROJECT_TEMPLATE_ROLLOUT_APPLIED"
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
    if (type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED") templateRuns += 1
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
  projectId: string
  summary7d: ReturnType<typeof buildWindowSummary>
  summary30d: ReturnType<typeof buildWindowSummary>
}): string {
  const lines: string[] = []
  lines.push("# Project Starter Rollout Summary")
  lines.push("")
  lines.push(`- Generated At: ${new Date().toISOString()}`)
  lines.push(`- Project ID: ${input.projectId}`)
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
 * GET /api/projects/[id]/starter-files/summary
 * Returns rollout summary metrics for recent windows.
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

    const { id } = await params
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user.id
        }
      },
      select: {
        projectId: true
      }
    })
    if (!membership) {
      return NextResponse.json(
        {
          error: "Not a project member",
          code: "NOT_PROJECT_MEMBER"
        },
        { status: 403 }
      )
    }

    const logs = await db.activityLog.findMany({
      where: {
        projectId: id,
        taskId: null,
        action: ActionType.TASK_UPDATED
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        createdAt: true,
        metadata: true
      }
    })

    const payload = {
      projectId: id,
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
    console.error("Project starter rollout summary fetch error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch project starter rollout summary",
        code: "INTERNAL_ERROR",
        projectId: null,
        summary7d: buildWindowSummary([], 7),
        summary30d: buildWindowSummary([], 30)
      },
      { status: 500 }
    )
  }
}
