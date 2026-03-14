import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function buildMarkdown(input: {
  projectId: string
  history: Array<{
    createdAt: string
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
  lines.push(`# Project Starter Rollout History`)
  lines.push("")
  lines.push(`- Generated At: ${new Date().toISOString()}`)
  lines.push(`- Project ID: ${input.projectId}`)
  lines.push(`- Records: ${input.history.length}`)
  lines.push("")
  lines.push("| Time | Artifact | Scope | Result | Skipped | Actor |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const item of input.history) {
    const artifact =
      item.packName ||
      item.packId ||
      item.templateName ||
      item.templateId ||
      "-"
    const artifactText =
      item.templateCategory && item.templateCategory.length > 0
        ? `${item.artifactType}:${artifact} (${item.templateCategory})`
        : `${item.artifactType}:${artifact}`
    const result = item.dryRun
      ? `dry-run (wouldCreate=${item.wouldCreateCount})`
      : `created=${item.createdCount}`
    const actor = item.actor?.name || item.actor?.email || "Unknown user"
    lines.push(
      `| ${item.createdAt} | ${artifactText.replace(/\|/g, "\\|")} | ${item.scope} | ${result} | ${item.skippedCount} | ${actor.replace(/\|/g, "\\|")} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/projects/[id]/starter-files/history
 * Returns recent starter pack apply history for a project.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", history: [] },
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
      }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER", history: [] },
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
      take: 20,
      select: {
        createdAt: true,
        metadata: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

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

    const payload = {
      projectId: id,
      history
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
    console.error("Starter files history fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch starter files history", code: "INTERNAL_ERROR", history: [] },
      { status: 500 }
    )
  }
}
