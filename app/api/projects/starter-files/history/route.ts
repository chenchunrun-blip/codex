import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  sourceProjectId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  format: z.enum(["markdown"]).optional()
})

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function buildMarkdown(input: {
  sourceProjectIds: string[]
  history: Array<{
    createdAt: string
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
  lines.push("# Projects Starter Rollout History")
  lines.push("")
  lines.push(`- Generated At: ${new Date().toISOString()}`)
  lines.push(`- Source Projects: ${input.sourceProjectIds.length}`)
  lines.push(`- Records: ${input.history.length}`)
  lines.push("")
  lines.push("| Time | Project | Artifact | Scope | Result | Skipped | Actor |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const item of input.history) {
    const artifact = item.packName || item.packId || item.templateName || item.templateId || "-"
    const artifactText =
      item.templateCategory && item.templateCategory.length > 0
        ? `${item.artifactType}:${artifact} (${item.templateCategory})`
        : `${item.artifactType}:${artifact}`
    const result = item.dryRun
      ? `dry-run (wouldCreate=${item.wouldCreateCount})`
      : `created=${item.createdCount}`
    const actor = item.actor?.name || item.actor?.email || "Unknown user"
    const project = item.projectName || item.projectId || "Unknown project"
    lines.push(
      `| ${item.createdAt} | ${project.replace(/\|/g, "\\|")} | ${artifactText.replace(/\|/g, "\\|")} | ${item.scope} | ${result} | ${item.skippedCount} | ${actor.replace(/\|/g, "\\|")} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/projects/starter-files/history
 * Query params: sourceProjectId, limit, format=markdown
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
      sourceProjectId: url.searchParams.get("sourceProjectId") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      format: url.searchParams.get("format") || undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS", history: [] },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: {
        projectId: true,
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
    const accessibleProjectIds = memberships.map((item) => item.projectId)
    if (parsed.data.sourceProjectId && !accessibleProjectIds.includes(parsed.data.sourceProjectId)) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER", history: [] },
        { status: 403 }
      )
    }

    const sourceProjectIds =
      parsed.data.sourceProjectId && accessibleProjectIds.includes(parsed.data.sourceProjectId)
        ? [parsed.data.sourceProjectId]
        : accessibleProjectIds

    const limit = parsed.data.limit || 50
    const logs = sourceProjectIds.length
      ? await db.activityLog.findMany({
          where: {
            projectId: { in: sourceProjectIds },
            taskId: null,
            action: ActionType.TASK_UPDATED
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
                name: true
              }
            }
          }
        })
      : []

    const history = logs
      .filter((row) => {
        const type = metadataType(row.metadata)
        return type === "PROJECT_STARTER_PACK_APPLIED" || type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED"
      })
      .map((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>
        const type = metadataType(row.metadata)
        const artifactType: "PACK" | "TEMPLATE" =
          type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED" ? "TEMPLATE" : "PACK"
        return {
          createdAt: row.createdAt.toISOString(),
          projectId: row.projectId,
          projectName: row.project?.name || null,
          packId: typeof metadata.packId === "string" ? metadata.packId : null,
          packName: typeof metadata.packName === "string" ? metadata.packName : null,
          templateId: typeof metadata.templateId === "string" ? metadata.templateId : null,
          templateName: typeof metadata.templateName === "string" ? metadata.templateName : null,
          templateCategory:
            typeof metadata.templateCategory === "string" ? metadata.templateCategory : null,
          artifactType,
          scope: typeof metadata.scope === "string" ? metadata.scope : "single",
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
      sourceProjectIds,
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
    console.error("Projects starter history fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch projects starter history", code: "INTERNAL_ERROR", history: [] },
      { status: 500 }
    )
  }
}
