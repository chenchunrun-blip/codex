import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

/**
 * GET /api/tasks/scheduler/bulk-history
 * Returns recent scheduler batch completion history across all accessible projects.
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const daysRaw = Number(searchParams.get("days") || 7)
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 30) : 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user!.id },
      select: { projectId: true }
    })
    const projectIds = memberships.map((item) => item.projectId)
    if (projectIds.length === 0) {
      return NextResponse.json({ history: [] })
    }

    const [projects, logs] = await Promise.all([
      db.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true }
      }),
      db.activityLog.findMany({
        where: {
          projectId: { in: projectIds },
          taskId: null,
          action: ActionType.TASK_UPDATED,
          createdAt: { gte: since }
        },
        orderBy: { createdAt: "desc" },
        take: 120,
        select: {
          projectId: true,
          createdAt: true,
          metadata: true
        }
      })
    ])

    const projectNameMap = new Map(projects.map((project) => [project.id, project.name]))
    const history = logs
      .map((log) => {
        const type = getMetadataType(log.metadata)
        if (type !== "AGENT_AUTO_DISPATCH_BATCH_COMPLETED") return null
        if (!log.projectId || !log.metadata || typeof log.metadata !== "object") return null
        const metadata = log.metadata as Record<string, unknown>
        const results = Array.isArray(metadata.results) ? metadata.results : []
        const failedTaskIds = results
          .map((item) => {
            if (!item || typeof item !== "object") return null
            const row = item as Record<string, unknown>
            if (row.status !== "FAILED") return null
            return typeof row.taskId === "string" ? row.taskId : null
          })
          .filter((item): item is string => Boolean(item))

        return {
          projectId: log.projectId,
          projectName: projectNameMap.get(log.projectId) || "Unknown Project",
          createdAt: log.createdAt.toISOString(),
          triggerMode: typeof metadata.triggerMode === "string" ? metadata.triggerMode : "UNKNOWN",
          total: typeof metadata.total === "number" ? metadata.total : 0,
          successCount: typeof metadata.successCount === "number" ? metadata.successCount : 0,
          failedCount: typeof metadata.failedCount === "number" ? metadata.failedCount : 0,
          batchId: typeof metadata.batchId === "string" ? metadata.batchId : null,
          idempotencyKey: typeof metadata.idempotencyKey === "string" ? metadata.idempotencyKey : null,
          failedTaskIds
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    return NextResponse.json({ history })
  } catch (error) {
    console.error("Bulk history fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch bulk scheduler history", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
