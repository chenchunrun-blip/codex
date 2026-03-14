import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { projectCreateSchema } from "@/lib/utils/validation"
import { generateFileName } from "@/lib/utils/file-naming"
import { NextResponse } from "next/server"
import { FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const parsed = projectCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data
    const { starterTemplateIds, ...projectPayload } = validated

    // Verify user is member of the team
    const teamMember = await db.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: projectPayload.teamId,
          userId: session.user!.id
        }
      }
    })

    if (!teamMember) {
      return NextResponse.json(
        { error: "Not a team member", code: "NOT_TEAM_MEMBER" },
        { status: 403 }
      )
    }

    const project = await db.project.create({
      data: {
        ...projectPayload,
        creatorId: session.user!.id,
        members: {
          create: {
            userId: session.user!.id,
            role: ProjectRole.ADMIN
          }
        }
      },
      include: {
        members: {
          include: { user: true }
        },
        team: true
      }
    })

    if (starterTemplateIds.length > 0) {
      const templates = await db.template.findMany({
        where: {
          id: { in: starterTemplateIds },
          OR: [{ isPublic: true }, { creatorId: session.user!.id }]
        },
        select: {
          id: true,
          name: true,
          category: true,
          content: true
        }
      })

      if (templates.length > 0) {
        const now = new Date()
        const fileRows = templates.map((template) => ({
          name: generateFileName(project.name, template.category),
          content: template.content,
          fileType: FileTypeEnum.CUSTOM,
          status: FileStatus.DRAFT,
          projectName: project.name,
          templateType: template.category,
          creatorId: session.user!.id,
          projectId: project.id,
          storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        }))

        await db.file.createMany({
          data: fileRows
        })

        const createdFiles = await db.file.findMany({
          where: {
            projectId: project.id,
            creatorId: session.user!.id,
            createdAt: { gte: now }
          },
          select: {
            id: true,
            templateType: true
          }
        })

        if (createdFiles.length > 0) {
          const templateIdByCategory = new Map<string, string>(
            templates.map((template) => [template.category, template.id])
          )
          await db.activityLog.createMany({
            data: createdFiles.map((file) => ({
              projectId: project.id,
              fileId: file.id,
              userId: session.user!.id,
              action: "FILE_CREATED",
              metadata: {
                type: "FILE_CREATED_FROM_TEMPLATE",
                templateId: file.templateType ? templateIdByCategory.get(file.templateType) : null
              }
            }))
          })
        }
      }
    }

    return NextResponse.json({
      ...project,
      starterTemplatesApplied: starterTemplateIds.length
    })
  } catch (error) {
    console.error("Project creation error:", error)
    return NextResponse.json(
      { error: "Failed to create project", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const teamId = searchParams.get('teamId')

    const projects = await db.project.findMany({
      where: {
        ...(teamId && { teamId }),
        members: {
          some: {
            userId: session.user!.id
          }
        }
      },
      include: {
        members: {
          include: { user: true }
        },
        team: true,
        _count: {
          select: {
            files: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(projects)
  } catch (error) {
    console.error("Projects fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch projects", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
