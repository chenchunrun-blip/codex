import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { generateFileName } from "@/lib/utils/file-naming"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  packId: z.enum(["PM_STARTER", "IT_RD_STARTER", "OPS_INCIDENT_STARTER"]),
  skipExistingByTemplateType: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false)
})

/**
 * POST /api/projects/[id]/starter-files/apply-pack
 * Apply a starter pack directly (without providing raw template IDs).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

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
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }
    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    if (roleHierarchy[membership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true
      }
    })
    if (!project) {
      return NextResponse.json(
        { error: "Project not found", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const availableTemplates = await db.template.findMany({
      where: {
        isBuiltIn: true,
        OR: [{ isPublic: true }, { creatorId: session.user.id }]
      },
      select: {
        id: true,
        name: true,
        category: true,
        content: true
      }
    })
    const pack = deriveStarterTemplatePacks(
      availableTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        category: template.category
      }))
    ).find((item) => item.id === parsed.data.packId)

    if (!pack) {
      return NextResponse.json(
        { error: "Starter pack not found", code: "STARTER_PACK_NOT_FOUND" },
        { status: 404 }
      )
    }

    const templates = availableTemplates.filter((template) => pack.templateIds.includes(template.id))
    if (templates.length === 0) {
      return NextResponse.json(
        { error: "No templates available for pack", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }

    const existingTemplateTypes = parsed.data.skipExistingByTemplateType
      ? new Set(
          (
            await db.file.findMany({
              where: {
                projectId: id,
                templateType: { in: templates.map((template) => template.category) }
              },
              select: {
                templateType: true
              }
            })
          )
            .map((row) => row.templateType)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      : new Set<string>()

    const createCandidates = templates.filter((template) => !existingTemplateTypes.has(template.category))
    const skipped = templates
      .filter((template) => existingTemplateTypes.has(template.category))
      .map((template) => ({
        templateId: template.id,
        templateName: template.name,
        reason: "TEMPLATE_TYPE_ALREADY_EXISTS"
      }))

    const created: Array<{ fileId: string; templateId: string; templateName: string }> = []
    const wouldCreate = createCandidates.map((template) => ({
      templateId: template.id,
      templateName: template.name
    }))
    if (parsed.data.dryRun) {
      await db.activityLog.create({
        data: {
          projectId: id,
          taskId: null,
          userId: session.user.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "PROJECT_STARTER_PACK_APPLIED",
            scope: "single",
            packId: pack.id,
            packName: pack.name,
            dryRun: true,
            createdCount: 0,
            wouldCreateCount: wouldCreate.length,
            skippedCount: skipped.length
          }
        }
      })
      return NextResponse.json({
        projectId: id,
        packId: pack.id,
        packName: pack.name,
        dryRun: true,
        createdCount: 0,
        wouldCreateCount: wouldCreate.length,
        skippedCount: skipped.length,
        created,
        wouldCreate,
        skipped
      })
    }

    for (const template of createCandidates) {
      const file = await db.file.create({
        data: {
          name: generateFileName(project.name, template.category),
          content: template.content,
          fileType: FileTypeEnum.CUSTOM,
          status: FileStatus.DRAFT,
          projectName: project.name,
          templateType: template.category,
          creatorId: session.user.id,
          projectId: id,
          storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        },
        select: {
          id: true
        }
      })
      await db.activityLog.create({
        data: {
          projectId: id,
          fileId: file.id,
          userId: session.user.id,
          action: "FILE_CREATED",
          metadata: {
            type: "FILE_CREATED_FROM_TEMPLATE",
            templateId: template.id
          }
        }
      })
      created.push({
        fileId: file.id,
        templateId: template.id,
        templateName: template.name
      })
    }

    await db.activityLog.create({
      data: {
        projectId: id,
        taskId: null,
        userId: session.user.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          scope: "single",
          packId: pack.id,
          packName: pack.name,
          dryRun: false,
          createdCount: created.length,
          wouldCreateCount: 0,
          skippedCount: skipped.length
        }
      }
    })

    return NextResponse.json({
      projectId: id,
      packId: pack.id,
      packName: pack.name,
      dryRun: false,
      createdCount: created.length,
      wouldCreateCount: 0,
      skippedCount: skipped.length,
      created,
      wouldCreate: [],
      skipped
    })
  } catch (error) {
    console.error("Apply starter pack error:", error)
    return NextResponse.json(
      { error: "Failed to apply starter pack", code: "STARTER_PACK_APPLY_FAILED" },
      { status: 500 }
    )
  }
}
