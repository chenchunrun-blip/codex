import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveOperationsHealth, resolveOperationsStatus } from "@/lib/operations/status"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  sourceProjectId: z.string().min(1).optional()
})

/**
 * GET /api/operations/health
 * Query params:
 * - sourceProjectId: optional project scope
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
      sourceProjectId: url.searchParams.get("sourceProjectId") || undefined
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
    const health = deriveOperationsHealth(status)

    return NextResponse.json({
      generatedAt: status.generatedAt,
      sourceProjectId: status.sourceProjectId,
      status,
      health
    })
  } catch (error) {
    console.error("Operations health route error:", error)
    return NextResponse.json(
      { error: "Failed to load operations health", code: "OPERATIONS_HEALTH_FAILED" },
      { status: 500 }
    )
  }
}
