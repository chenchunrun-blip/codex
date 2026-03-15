import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { generateFileName } from "@/lib/utils/file-naming"
import { FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  templateIds: z.array(z.string().min(1)).min(1).max(20),
  skipExistingByTemplateType: z.boolean().optional().default(true)
})

/**
 * POST /api/projects/[id]/starter-files
 * Apply starter templates to an existing project by creating project files.
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

    const templateIds = Array.from(new Set(parsed.data.templateIds))
    const templates = await db.template.findMany({
      where: {
        id: { in: templateIds },
        OR: [{ isPublic: true }, { creatorId: session.user.id }]
      },
      select: {
        id: true,
        name: true,
        category: true,
        content: true
      }
    })
    if (templates.length === 0) {
      return NextResponse.json(
        { error: "No valid templates found", code: "TEMPLATE_NOT_FOUND" },
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

    return NextResponse.json({
      projectId: id,
      totalRequested: templateIds.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped
    })
  } catch (error) {
    console.error("Apply starter files error:", error)
    return NextResponse.json(
      { error: "Failed to apply starter files", code: "STARTER_FILES_APPLY_FAILED" },
      { status: 500 }
    )
  }
}

