import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { generateFileName } from "@/lib/utils/file-naming"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  templateId: z.string().min(1),
  skipExistingByTemplateType: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false)
})

/**
 * POST /api/projects/[id]/starter-files/apply-template
 * Apply a single template to current project.
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

    const template = await db.template.findFirst({
      where: {
        id: parsed.data.templateId,
        OR: [{ isPublic: true }, { isBuiltIn: true }, { creatorId: session.user.id }]
      },
      select: {
        id: true,
        name: true,
        category: true,
        content: true
      }
    })
    if (!template) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }

    let shouldSkip = false
    if (parsed.data.skipExistingByTemplateType) {
      const existing = await db.file.findFirst({
        where: {
          projectId: id,
          templateType: template.category
        },
        select: { id: true }
      })
      shouldSkip = Boolean(existing)
    }

    const wouldCreateCount = shouldSkip ? 0 : 1
    if (parsed.data.dryRun) {
      await db.activityLog.create({
        data: {
          projectId: id,
          taskId: null,
          userId: session.user.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
            scope: "single",
            templateId: template.id,
            templateName: template.name,
            templateCategory: template.category,
            dryRun: true,
            createdCount: 0,
            wouldCreateCount,
            skippedCount: shouldSkip ? 1 : 0
          }
        }
      })
      return NextResponse.json({
        projectId: id,
        templateId: template.id,
        templateName: template.name,
        templateCategory: template.category,
        dryRun: true,
        createdCount: 0,
        wouldCreateCount,
        skippedCount: shouldSkip ? 1 : 0
      })
    }

    let createdFileId: string | null = null
    if (!shouldSkip) {
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
      createdFileId = file.id
      await db.activityLog.create({
        data: {
          projectId: id,
          fileId: file.id,
          userId: session.user.id,
          action: ActionType.FILE_CREATED,
          metadata: {
            type: "FILE_CREATED_FROM_TEMPLATE",
            templateId: template.id
          }
        }
      })
    }

    await db.activityLog.create({
      data: {
        projectId: id,
        taskId: null,
        userId: session.user.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
          scope: "single",
          templateId: template.id,
          templateName: template.name,
          templateCategory: template.category,
          dryRun: false,
          createdCount: shouldSkip ? 0 : 1,
          wouldCreateCount: 0,
          skippedCount: shouldSkip ? 1 : 0
        }
      }
    })

    return NextResponse.json({
      projectId: id,
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      dryRun: false,
      createdCount: shouldSkip ? 0 : 1,
      wouldCreateCount: 0,
      skippedCount: shouldSkip ? 1 : 0,
      fileId: createdFileId
    })
  } catch (error) {
    console.error("Apply project template error:", error)
    return NextResponse.json(
      { error: "Failed to apply template", code: "PROJECT_TEMPLATE_ROLLOUT_FAILED" },
      { status: 500 }
    )
  }
}
