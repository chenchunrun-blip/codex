import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

/**
 * POST /api/templates/catalog/save
 * Save current templates catalog report as markdown file in a project.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            updatedAt: true
          }
        }
      },
      orderBy: {
        project: {
          updatedAt: "desc"
        }
      }
    })
    if (memberships.length === 0) {
      return NextResponse.json(
        { error: "No project membership found", code: "NO_PROJECT_MEMBERSHIP" },
        { status: 400 }
      )
    }
    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const targetMembership = parsed.data.projectId
      ? memberships.find((item) => item.projectId === parsed.data.projectId)
      : memberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found in your memberships", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (roleHierarchy[targetMembership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
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

    const lines: string[] = []
    lines.push("# Templates Catalog Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Total Templates: ${templates.length}`)
    lines.push("")
    lines.push("| Template | Category | Built-in | Used | Last Used | Updated At |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const template of templates) {
      const usage = usageMap.get(template.id)
      lines.push(
        `| ${template.name.replace(/\|/g, "\\|")} | ${template.category} | ${template.isBuiltIn ? "yes" : "no"} | ${usage?.count || 0} | ${usage?.lastUsedAt || "-"} | ${template.updatedAt.toISOString()} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `templates-catalog-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TEMPLATES_CATALOG",
        creatorId: session.user.id,
        projectId: targetMembership.project.id,
        storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
      },
      select: {
        id: true,
        name: true,
        projectId: true,
        createdAt: true
      }
    })
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        projectId: targetMembership.project.id,
        fileId: reportFile.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "TEMPLATES_CATALOG_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Templates catalog saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save templates catalog error:", error)
    return NextResponse.json(
      { error: "Failed to save templates catalog", code: "TEMPLATES_CATALOG_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
