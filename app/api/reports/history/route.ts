import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { queryReportsHistoryPage } from "@/lib/reports/history-query"
import { NextResponse } from "next/server"

function buildMarkdown(input: {
  generatedAt: string
  history: Array<{
    createdAt: string
    type: string
    projectName: string
    actorName: string
    fileName: string
    fileId: string | null
  }>
}) {
  const rows =
    input.history.length === 0
      ? "- No report history entries"
      : input.history
          .map(
            (item) =>
              `- ${item.createdAt} | ${item.type} | ${item.projectName} | ${item.actorName} | ${item.fileName}${item.fileId ? ` (${item.fileId})` : ""}`
          )
          .join("\n")

  return `# Reports History

- Generated At: ${input.generatedAt}
- Records: ${input.history.length}

## Entries
${rows}
`
}

/**
 * GET /api/reports/history
 * Query:
 * - type: report metadata type
 * - projectId: project scope
 * - q: search in project/file/actor/type
 * - limit: default 50, max 200
 * - page: default 1
 * - format=markdown: return markdown text
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

    const { searchParams } = new URL(req.url)
    const typeFilter = searchParams.get("type")?.trim() || ""
    const q = searchParams.get("q")?.trim().toLowerCase() || ""
    const projectId = searchParams.get("projectId")?.trim() || ""
    const rawLimit = Number(searchParams.get("limit") || "50")
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50
    const rawPage = Number(searchParams.get("page") || "1")
    const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1
    const offset = (page - 1) * limit

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: { projectId: true }
    })
    const accessibleProjectIds = new Set(memberships.map((item) => item.projectId))
    const scopedProjectIds = projectId
      ? accessibleProjectIds.has(projectId)
        ? [projectId]
        : []
      : Array.from(accessibleProjectIds)

    if (scopedProjectIds.length === 0) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        page,
        limit,
        hasMore: false,
        history: []
      })
    }

    const result = await queryReportsHistoryPage({
      projectIds: scopedProjectIds,
      typeFilter,
      q,
      limit,
      offset
    })

    const generatedAt = new Date().toISOString()
    const payload = {
      generatedAt,
      page,
      limit,
      hasMore: result.hasMore,
      history: result.history
    }

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
    console.error("Reports history error:", error)
    return NextResponse.json(
      { error: "Failed to fetch reports history", code: "REPORTS_HISTORY_FAILED" },
      { status: 500 }
    )
  }
}
