import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  buildOperationsStatusMarkdown,
  resolveOperationsStatus
} from "@/lib/operations/status"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  sourceProjectId: z.string().min(1).optional(),
  format: z.enum(["markdown"]).optional()
})

/**
 * GET /api/operations/status
 * Query params:
 * - sourceProjectId: optional project scope
 * - format=markdown: optional markdown response
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

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      sourceProjectId: url.searchParams.get("sourceProjectId") || undefined,
      format: url.searchParams.get("format") || undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: { projectId: true }
    })
    const accessibleProjectIds = new Set(memberships.map((item) => item.projectId))
    if (parsed.data.sourceProjectId && !accessibleProjectIds.has(parsed.data.sourceProjectId)) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const status = await resolveOperationsStatus({
      projectIds: Array.from(accessibleProjectIds),
      sourceProjectId: parsed.data.sourceProjectId
    })

    if (parsed.data.format === "markdown") {
      return new Response(buildOperationsStatusMarkdown(status), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error("Operations status route error:", error)
    return NextResponse.json(
      { error: "Failed to load operations status", code: "OPERATIONS_STATUS_FAILED" },
      { status: 500 }
    )
  }
}
