import { requireAuth, requireProjectAccess } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { fileCreateSchema } from "@/lib/utils/validation"
import { generateFileName } from "@/lib/utils/file-naming"
import { NextResponse } from "next/server"
import { FileStatus, FileTypeEnum } from "@prisma/client"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = fileCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    // Verify project access
    const { membership } = await requireProjectAccess(validated.projectId, "EDITOR")

    // Get project for naming
    const project = await db.project.findUnique({
      where: { id: validated.projectId }
    })

    if (!project) {
      return NextResponse.json(
        { error: "Project not found", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Get template content if provided
    let templateType = validated.name
    let fileType = FileTypeEnum.CUSTOM
    let fileContent = validated.content || ""

    if (validated.templateId) {
      const template = await db.template.findUnique({
        where: { id: validated.templateId },
        select: {
          id: true,
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
      templateType = template.category
      fileContent = template.content // Use template content
      // fileType remains CUSTOM for user-created files
    }

    // Generate standardized name
    const fileName = validated.name || generateFileName(project.name, templateType)

    // Generate storage ID for Liveblocks
    const storageId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const file = await db.file.create({
      data: {
        name: fileName,
        content: fileContent,
        fileType,
        status: FileStatus.DRAFT,
        projectName: project.name,
        templateType,
        creatorId: session.user.id,
        projectId: validated.projectId,
        storageId
      },
      include: {
        creator: true,
        project: true
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: validated.projectId,
        fileId: file.id,
        userId: session.user.id!,
        action: "FILE_CREATED",
        metadata: validated.templateId
          ? {
              type: "FILE_CREATED_FROM_TEMPLATE",
              templateId: validated.templateId
            }
          : {
              type: "FILE_CREATED_MANUAL"
            }
      }
    })

    return NextResponse.json(file)
  } catch (error) {
    console.error("File creation error:", error)
    return NextResponse.json(
      { error: "Failed to create file", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const fileType = searchParams.get('fileType')
    const search = searchParams.get('search')

    const files = await db.file.findMany({
      where: {
        ...(projectId && { projectId }),
        ...(fileType && { fileType: fileType as FileTypeEnum }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { content: { contains: search, mode: 'insensitive' } }
          ]
        }),
        project: {
          members: {
            some: {
              userId: session.user.id
            }
          }
        }
      },
      include: {
        creator: true,
        project: true,
        _count: {
          select: {
            versions: true,
            comments: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })

    return NextResponse.json(files)
  } catch (error) {
    console.error("Files fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch files", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
