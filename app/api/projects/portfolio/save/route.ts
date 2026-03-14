import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceProjectIds: z.array(z.string().min(1)).max(300).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/projects/portfolio/save
 * Save projects portfolio report as markdown file in a target project.
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

    const accessibleProjectIds = new Set(memberships.map((item) => item.projectId))
    const sourceProjectIds = parsed.data.sourceProjectIds?.length
      ? parsed.data.sourceProjectIds.filter((id) => accessibleProjectIds.has(id))
      : Array.from(accessibleProjectIds)

    const projects = await db.project.findMany({
      where: {
        id: { in: sourceProjectIds }
      },
      include: {
        team: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            files: true,
            members: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 300
    })

    const lines: string[] = []
    lines.push("# Projects Portfolio Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Projects: ${projects.length}`)
    lines.push("")
    lines.push("| Project | Team | Status | Files | Members | Updated At |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const project of projects) {
      lines.push(
        `| ${project.name.replace(/\|/g, "\\|")} | ${project.team.name.replace(/\|/g, "\\|")} | ${project.status} | ${project._count.files} | ${project._count.members} | ${project.updatedAt.toISOString()} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `projects-portfolio-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "PROJECTS_PORTFOLIO_REPORT",
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
          type: "PROJECTS_PORTFOLIO_REPORT_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Projects portfolio report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save projects portfolio report error:", error)
    return NextResponse.json(
      { error: "Failed to save projects portfolio report", code: "PROJECTS_PORTFOLIO_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
