import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const querySchema = z.object({
  sourceProjectId: z.string().min(1).optional(),
  format: z.enum(["markdown"]).optional()
})

type FileInventoryItem = {
  id: string
  name: string
  fileType: string
  status: string
  updatedAt: string
  project: {
    id: string
    name: string
  }
  linkedTaskCount: number
}

function buildFilesInventoryMarkdown(input: {
  generatedAt: Date
  sourceProjectIds: string[]
  files: FileInventoryItem[]
}) {
  const lines: string[] = []
  lines.push("# Files Inventory Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt.toISOString()}`)
  lines.push(`- Source Projects: ${input.sourceProjectIds.length}`)
  lines.push(`- Files: ${input.files.length}`)
  lines.push("")
  lines.push("| File | Project | Type | Status | Linked Tasks | Updated At |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const file of input.files) {
    lines.push(
      `| ${file.name.replace(/\|/g, "\\|")} | ${file.project.name.replace(/\|/g, "\\|")} | ${file.fileType} | ${file.status} | ${file.linkedTaskCount} | ${new Date(file.updatedAt).toISOString()} |`
    )
  }
  return lines.join("\n")
}

/**
 * GET /api/files/inventory
 * Query params: sourceProjectId, format=markdown
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
    const accessibleProjectIds = memberships.map((item) => item.projectId)

    if (parsed.data.sourceProjectId && !accessibleProjectIds.includes(parsed.data.sourceProjectId)) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const sourceProjectIds =
      parsed.data.sourceProjectId && accessibleProjectIds.includes(parsed.data.sourceProjectId)
        ? [parsed.data.sourceProjectId]
        : accessibleProjectIds

    const files = await db.file.findMany({
      where: {
        projectId: { in: sourceProjectIds }
      },
      select: {
        id: true,
        name: true,
        fileType: true,
        status: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 300
    })

    const fileIds = files.map((file) => file.id)
    const taskLinkLogs = fileIds.length
      ? await db.activityLog.findMany({
          where: {
            action: ActionType.TASK_CREATED,
            fileId: { in: fileIds },
            taskId: { not: null }
          },
          select: {
            fileId: true,
            taskId: true
          }
        })
      : []

    const linkedTaskMap = new Map<string, Set<string>>()
    for (const log of taskLinkLogs) {
      if (!log.fileId || !log.taskId) continue
      if (!linkedTaskMap.has(log.fileId)) linkedTaskMap.set(log.fileId, new Set<string>())
      linkedTaskMap.get(log.fileId)!.add(log.taskId)
    }

    const items: FileInventoryItem[] = files.map((file) => ({
      id: file.id,
      name: file.name,
      fileType: file.fileType,
      status: file.status,
      updatedAt: file.updatedAt.toISOString(),
      project: {
        id: file.project.id,
        name: file.project.name
      },
      linkedTaskCount: linkedTaskMap.get(file.id)?.size || 0
    }))

    const generatedAt = new Date()
    if (parsed.data.format === "markdown") {
      const markdown = buildFilesInventoryMarkdown({
        generatedAt,
        sourceProjectIds,
        files: items
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
      total: items.length,
      sourceProjectIds,
      files: items
    })
  } catch (error) {
    console.error("Files inventory route error:", error)
    return NextResponse.json(
      { error: "Failed to fetch files inventory", code: "FILES_INVENTORY_FAILED" },
      { status: 500 }
    )
  }
}
