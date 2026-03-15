import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { generateFileName } from "@/lib/utils/file-naming"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole, TeamRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  packId: z.enum(["PM_STARTER", "IT_RD_STARTER", "OPS_INCIDENT_STARTER"]),
  projectIds: z.array(z.string().min(1)).max(100).optional(),
  skipExistingByTemplateType: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false)
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: teamId } = await params
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

    const membership = await db.teamMember.findFirst({
      where: {
        teamId,
        userId: session.user.id
      },
      select: {
        role: true
      }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Team membership required", code: "TEAM_ACCESS_DENIED" },
        { status: 403 }
      )
    }
    if (membership.role !== TeamRole.ADMIN) {
      return NextResponse.json(
        { error: "Admin role required", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const teamProjects = await db.project.findMany({
      where: {
        teamId,
        ...(parsed.data.projectIds?.length ? { id: { in: parsed.data.projectIds } } : {})
      },
      select: {
        id: true,
        name: true
      }
    })
    if (teamProjects.length === 0) {
      return NextResponse.json(
        { error: "No projects found in team", code: "TEAM_PROJECTS_NOT_FOUND" },
        { status: 404 }
      )
    }

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const projectMemberships = await db.projectMember.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: teamProjects.map((project) => project.id) }
      },
      select: {
        projectId: true,
        role: true
      }
    })
    const editableProjectIdSet = new Set(
      projectMemberships
        .filter((membershipItem) => roleHierarchy[membershipItem.role] >= roleHierarchy[ProjectRole.EDITOR])
        .map((membershipItem) => membershipItem.projectId)
    )

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

    const results: Array<{
      projectId: string
      projectName: string
      ok: boolean
      createdCount: number
      wouldCreateCount: number
      skippedCount: number
      message: string
    }> = []

    for (const project of teamProjects) {
      if (!editableProjectIdSet.has(project.id)) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          ok: false,
          createdCount: 0,
          wouldCreateCount: 0,
          skippedCount: 0,
          message: "INSUFFICIENT_PROJECT_PERMISSIONS"
        })
        continue
      }

      const existingTemplateTypes = parsed.data.skipExistingByTemplateType
        ? new Set(
            (
              await db.file.findMany({
                where: {
                  projectId: project.id,
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
      let createdCount = 0
      const wouldCreateCount = createCandidates.length

      if (!parsed.data.dryRun) {
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
              projectId: project.id,
              storageId: `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
            },
            select: {
              id: true
            }
          })
          await db.activityLog.create({
            data: {
              projectId: project.id,
              fileId: file.id,
              userId: session.user.id,
              action: ActionType.FILE_CREATED,
              metadata: {
                type: "FILE_CREATED_FROM_TEMPLATE",
                templateId: template.id
              }
            }
          })
          createdCount += 1
        }
      }

      results.push({
        projectId: project.id,
        projectName: project.name,
        ok: true,
        createdCount,
        wouldCreateCount,
        skippedCount: templates.length - createCandidates.length,
        message: parsed.data.dryRun ? "DRY_RUN" : "APPLIED"
      })

      await db.activityLog.create({
        data: {
          projectId: project.id,
          taskId: null,
          userId: session.user.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "TEAM_STARTER_PACK_APPLIED",
            scope: "team_bulk",
            teamId,
            packId: pack.id,
            packName: pack.name,
            dryRun: parsed.data.dryRun,
            createdCount,
            wouldCreateCount,
            skippedCount: templates.length - createCandidates.length
          }
        }
      })
    }

    return NextResponse.json({
      teamId,
      packId: pack.id,
      packName: pack.name,
      dryRun: parsed.data.dryRun,
      total: teamProjects.length,
      successCount: results.filter((item) => item.ok).length,
      failedCount: results.filter((item) => !item.ok).length,
      results
    })
  } catch (error) {
    console.error("Team starter pack apply error:", error)
    return NextResponse.json(
      { error: "Failed to apply starter pack for team", code: "TEAM_STARTER_PACK_APPLY_FAILED" },
      { status: 500 }
    )
  }
}
