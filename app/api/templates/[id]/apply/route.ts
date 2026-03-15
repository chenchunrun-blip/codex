import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1).max(100),
  dryRun: z.boolean().optional(),
  skipExistingByTemplateType: z.boolean().optional()
})

/**
 * POST /api/templates/[id]/apply
 * Apply a template to one or more projects in bulk.
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

    const { id: templateId } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const template = await db.template.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        name: true,
        category: true,
        content: true,
        isBuiltIn: true,
        isPublic: true,
        creatorId: true
      }
    })
    if (!template) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (!template.isBuiltIn && !template.isPublic && template.creatorId !== session.user.id) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const uniqueProjectIds = Array.from(new Set(parsed.data.projectIds))
    const editableMemberships = await db.projectMember.findMany({
      where: {
        userId: session.user.id,
        role: { in: [ProjectRole.ADMIN, ProjectRole.EDITOR] },
        projectId: { in: uniqueProjectIds }
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    const membershipByProjectId = new Map(editableMemberships.map((item) => [item.projectId, item]))
    const dryRun = parsed.data.dryRun === true
    const skipExistingByTemplateType = parsed.data.skipExistingByTemplateType === true

    const results: Array<{
      projectId: string
      ok: boolean
      createdCount: number
      wouldCreateCount: number
      skippedCount: number
      message: string
      fileId: string | null
    }> = []

    for (const projectId of uniqueProjectIds) {
      const membership = membershipByProjectId.get(projectId)
      if (!membership) {
        results.push({
          projectId,
          ok: false,
          createdCount: 0,
          wouldCreateCount: 0,
          skippedCount: 0,
          message: "No editable project membership",
          fileId: null
        })
        continue
      }

      if (skipExistingByTemplateType) {
        const existingCount = await db.file.count({
          where: {
            projectId,
            templateType: template.category
          }
        })
        if (existingCount > 0) {
          results.push({
            projectId,
            ok: true,
            createdCount: 0,
            wouldCreateCount: 0,
            skippedCount: 1,
            message: "Skipped existing template type in project",
            fileId: null
          })
          continue
        }
      }

      if (dryRun) {
        results.push({
          projectId,
          ok: true,
          createdCount: 0,
          wouldCreateCount: 1,
          skippedCount: 0,
          message: "Dry run only",
          fileId: null
        })
        continue
      }

      const file = await db.file.create({
        data: {
          name: `${template.name} - ${new Date().toISOString().slice(0, 10)}`,
          content: template.content,
          fileType: FileTypeEnum.CUSTOM,
          status: FileStatus.DRAFT,
          projectName: membership.project.name,
          templateType: template.category,
          creatorId: session.user.id,
          projectId,
          storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
        },
        select: {
          id: true
        }
      })

      await db.activityLog.create({
        data: {
          userId: session.user.id,
          projectId,
          fileId: file.id,
          action: ActionType.FILE_CREATED,
          metadata: {
            type: "FILE_CREATED_FROM_TEMPLATE",
            source: "TEMPLATE_BULK_APPLY",
            templateId: template.id
          }
        }
      })

      results.push({
        projectId,
        ok: true,
        createdCount: 1,
        wouldCreateCount: 0,
        skippedCount: 0,
        message: "Created",
        fileId: file.id
      })
    }

    const summary = {
      total: results.length,
      success: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      createdTotal: results.reduce((acc, item) => acc + item.createdCount, 0),
      wouldCreateTotal: results.reduce((acc, item) => acc + item.wouldCreateCount, 0),
      skippedTotal: results.reduce((acc, item) => acc + item.skippedCount, 0)
    }

    return NextResponse.json({
      templateId: template.id,
      templateName: template.name,
      dryRun,
      skipExistingByTemplateType,
      summary,
      results
    })
  } catch (error) {
    console.error("Template bulk apply error:", error)
    return NextResponse.json(
      { error: "Failed to apply template to projects", code: "TEMPLATE_BULK_APPLY_FAILED" },
      { status: 500 }
    )
  }
}
