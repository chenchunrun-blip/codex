import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/templates/starter-packs/save
 * Save starter packs catalog as markdown file in an editable project.
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

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const editableMemberships = memberships.filter(
      (item) => roleHierarchy[item.role] >= roleHierarchy[ProjectRole.EDITOR]
    )
    if (editableMemberships.length === 0) {
      return NextResponse.json(
        { error: "No editable project membership found", code: "NO_EDITABLE_PROJECT" },
        { status: 403 }
      )
    }

    const targetMembership = parsed.data.projectId
      ? editableMemberships.find((item) => item.projectId === parsed.data.projectId)
      : editableMemberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found or not editable", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const templates = await db.template.findMany({
      where: {
        isBuiltIn: true,
        OR: [{ isPublic: true }, { creatorId: session.user.id }]
      },
      select: {
        id: true,
        name: true,
        category: true
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    })

    const packs = deriveStarterTemplatePacks(templates)
    const templateNameById = new Map(templates.map((template) => [template.id, template.name]))

    const lines: string[] = []
    lines.push("# Template Starter Packs Catalog")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Packs: ${packs.length}`)
    lines.push(`- Built-in Templates: ${templates.length}`)
    lines.push("")

    if (packs.length === 0) {
      lines.push("No starter packs available.")
    } else {
      lines.push("## Packs")
      for (const pack of packs) {
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
    for (const template of templates) {
      lines.push(
        `| ${template.id} | ${template.name.replace(/\|/g, "\\|")} | ${template.category} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `template-starter-packs-${timestamp}.md`

    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TEMPLATE_STARTER_PACKS",
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
          type: "TEMPLATE_STARTER_PACKS_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Template starter packs saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save template starter packs error:", error)
    return NextResponse.json(
      { error: "Failed to save template starter packs", code: "TEMPLATE_STARTER_PACKS_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
