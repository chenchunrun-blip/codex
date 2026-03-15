import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  sourceProjectId: z.string().min(1).optional(),
  format: z.enum(["markdown"]).optional()
})

type PortfolioItem = {
  id: string
  name: string
  teamName: string
  status: string
  fileCount: number
  memberCount: number
  updatedAt: string
}

function buildPortfolioMarkdown(input: { generatedAt: Date; projects: PortfolioItem[] }) {
  const lines: string[] = []
  lines.push("# Projects Portfolio Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Projects: ${input.projects.length}`)
  lines.push("")
  lines.push("| Project | Team | Status | Files | Members | Updated At |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const project of input.projects) {
    lines.push(
      `| ${project.name.replace(/\|/g, "\\|")} | ${project.teamName.replace(/\|/g, "\\|")} | ${project.status} | ${project.fileCount} | ${project.memberCount} | ${new Date(project.updatedAt).toISOString()} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/projects/portfolio
 * Query params:
 * - sourceProjectId: optional
 * - format=markdown: optional
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
    if (accessibleProjectIds.size === 0) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        total: 0,
        projects: []
      })
    }

    if (parsed.data.sourceProjectId && !accessibleProjectIds.has(parsed.data.sourceProjectId)) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const scopedProjectIds = parsed.data.sourceProjectId
      ? [parsed.data.sourceProjectId]
      : Array.from(accessibleProjectIds)

    const projects = await db.project.findMany({
      where: { id: { in: scopedProjectIds } },
      include: {
        team: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            files: true,
            members: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 300
    })

    const items: PortfolioItem[] = projects.map((project) => ({
      id: project.id,
      name: project.name,
      teamName: project.team.name,
      status: project.status,
      fileCount: project._count.files,
      memberCount: project._count.members,
      updatedAt: project.updatedAt.toISOString()
    }))

    const generatedAt = new Date()
    if (parsed.data.format === "markdown") {
      const markdown = buildPortfolioMarkdown({ generatedAt, projects: items })
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
      projects: items
    })
  } catch (error) {
    console.error("Projects portfolio route error:", error)
    return NextResponse.json(
      { error: "Failed to load projects portfolio", code: "PROJECTS_PORTFOLIO_FAILED" },
      { status: 500 }
    )
  }
}
