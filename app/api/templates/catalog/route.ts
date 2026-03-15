import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  format: z.enum(["markdown"]).optional()
})

type TemplateCatalogItem = {
  id: string
  name: string
  category: string
  isBuiltIn: boolean
  usageCount: number
  lastUsedAt: string | null
  updatedAt: string
}

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function buildTemplatesCatalogMarkdown(input: { generatedAt: Date; templates: TemplateCatalogItem[] }) {
  const lines: string[] = []
  lines.push("# Templates Catalog Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Templates: ${input.templates.length}`)
  lines.push("")
  lines.push("| Template | Category | Built-in | Used | Last Used | Updated At |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const template of input.templates) {
    lines.push(
      `| ${template.name.replace(/\|/g, "\\|")} | ${template.category} | ${template.isBuiltIn ? "yes" : "no"} | ${template.usageCount} | ${template.lastUsedAt || "-"} | ${new Date(template.updatedAt).toISOString()} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/templates/catalog
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

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      format: url.searchParams.get("format") || undefined
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const templates = await db.template.findMany({
      where: {
        OR: [{ isPublic: true }, { creatorId: session.user.id }]
      },
      select: {
        id: true,
        name: true,
        category: true,
        isBuiltIn: true,
        updatedAt: true
      },
      orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }]
    })

    const templateIds = templates.map((template) => template.id)
    const usageLogs = templateIds.length
      ? await db.activityLog.findMany({
          where: {
            action: ActionType.FILE_CREATED,
            project: {
              members: {
                some: { userId: session.user.id }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 1000,
          select: {
            createdAt: true,
            metadata: true
          }
        })
      : []

    const usageMap = new Map<string, { count: number; lastUsedAt: string | null }>()
    for (const log of usageLogs) {
      if (getMetadataType(log.metadata) !== "FILE_CREATED_FROM_TEMPLATE") continue
      const metadata = (log.metadata || {}) as Record<string, unknown>
      const templateId = typeof metadata.templateId === "string" ? metadata.templateId : null
      if (!templateId || !templateIds.includes(templateId)) continue
      const existing = usageMap.get(templateId) || { count: 0, lastUsedAt: null }
      usageMap.set(templateId, {
        count: existing.count + 1,
        lastUsedAt: existing.lastUsedAt || log.createdAt.toISOString()
      })
    }

    const items: TemplateCatalogItem[] = templates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      isBuiltIn: template.isBuiltIn,
      usageCount: usageMap.get(template.id)?.count || 0,
      lastUsedAt: usageMap.get(template.id)?.lastUsedAt || null,
      updatedAt: template.updatedAt.toISOString()
    }))

    const generatedAt = new Date()
    if (parsed.data.format === "markdown") {
      const markdown = buildTemplatesCatalogMarkdown({ generatedAt, templates: items })
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
      templates: items
    })
  } catch (error) {
    console.error("Templates catalog route error:", error)
    return NextResponse.json(
      { error: "Failed to load templates catalog", code: "TEMPLATES_CATALOG_FAILED" },
      { status: 500 }
    )
  }
}
