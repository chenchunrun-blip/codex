import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { generateFileName } from "@/lib/utils/file-naming"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole, TeamRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  templateId: z.string().min(1),
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
      select: { role: true }
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
        .filter((item) => roleHierarchy[item.role] >= roleHierarchy[ProjectRole.EDITOR])
        .map((item) => item.projectId)
    )

    const results: Array<{
      projectId: string
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
          ok: false,
          createdCount: 0,
          wouldCreateCount: 0,
          skippedCount: 0,
          message: "INSUFFICIENT_PROJECT_PERMISSIONS"
        })
        continue
      }

      let shouldSkip = false
      if (parsed.data.skipExistingByTemplateType) {
        const existing = await db.file.findFirst({
          where: {
            projectId: project.id,
            templateType: template.category
          },
          select: {
            id: true
          }
        })
        shouldSkip = Boolean(existing)
      }

      const wouldCreateCount = shouldSkip ? 0 : 1
      let createdCount = 0
      const skippedCount = shouldSkip ? 1 : 0

      if (!parsed.data.dryRun && !shouldSkip) {
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
          select: { id: true }
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
        createdCount = 1
      }

      results.push({
        projectId: project.id,
        ok: true,
        createdCount,
        wouldCreateCount,
        skippedCount,
        message: parsed.data.dryRun ? "DRY_RUN" : "APPLIED"
      })

      await db.activityLog.create({
        data: {
          projectId: project.id,
          taskId: null,
          userId: session.user.id,
          action: ActionType.TASK_UPDATED,
          metadata: {
            type: "TEAM_TEMPLATE_ROLLOUT_APPLIED",
            scope: "team_bulk",
            teamId,
            templateId: template.id,
            templateName: template.name,
            templateCategory: template.category,
            dryRun: parsed.data.dryRun,
            createdCount,
            wouldCreateCount,
            skippedCount
          }
        }
      })
    }

    return NextResponse.json({
      teamId,
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      dryRun: parsed.data.dryRun,
      total: teamProjects.length,
      successCount: results.filter((item) => item.ok).length,
      failedCount: results.filter((item) => !item.ok).length,
      results
    })
  } catch (error) {
    console.error("Team template rollout error:", error)
    return NextResponse.json(
      { error: "Failed to roll out template for team", code: "TEAM_TEMPLATE_ROLLOUT_FAILED" },
      { status: 500 }
    )
  }
}
