import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  format: z.enum(["markdown"]).optional()
})

function buildStarterPacksMarkdown(input: {
  generatedAt: Date
  packs: Array<{
    id: string
    name: string
    description: string
    templateIds: string[]
  }>
  templates: Array<{
    id: string
    name: string
    category: string
  }>
}) {
  const templateNameById = new Map(input.templates.map((template) => [template.id, template.name]))
  const lines: string[] = []
  lines.push("# Template Starter Packs Catalog")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Packs: ${input.packs.length}`)
  lines.push(`- Built-in Templates: ${input.templates.length}`)
  lines.push("")
  if (input.packs.length === 0) {
    lines.push("No starter packs available.")
  } else {
    lines.push("## Packs")
    for (const pack of input.packs) {
      lines.push("")
      lines.push(`### ${pack.name} (${pack.id})`)
      lines.push(pack.description)
      lines.push("")
      lines.push("| Template ID | Template Name |")
      lines.push("| --- | --- |")
      for (const templateId of pack.templateIds) {
        lines.push(`| ${templateId} | ${(templateNameById.get(templateId) || templateId).replace(/\|/g, "\\|")} |`)
      }
    }
  }
  lines.push("")
  lines.push("## Built-in Templates")
  lines.push("| Template ID | Name | Category |")
  lines.push("| --- | --- | --- |")
  for (const template of input.templates) {
    lines.push(`| ${template.id} | ${template.name.replace(/\|/g, "\\|")} | ${template.category} |`)
  }
  return lines.join("\n")
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
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
        isBuiltIn: true,
        OR: [{ isPublic: true }, { creatorId: session.user!.id }]
      },
      select: {
        id: true,
        name: true,
        category: true
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    })

    const packs = deriveStarterTemplatePacks(templates)
    const generatedAt = new Date()

    if (parsed.data.format === "markdown") {
      const markdown = buildStarterPacksMarkdown({
        generatedAt,
        packs,
        templates
      })
      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json({
      generatedAt: generatedAt.toISOString(),
      packs,
      templates
    })
  } catch (error) {
    console.error("Starter packs fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch starter packs", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
