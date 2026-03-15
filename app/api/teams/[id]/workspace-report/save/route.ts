import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  buildTeamWorkspaceMarkdown,
  resolveTeamWorkspaceReport
} from "@/lib/teams/workspace-report"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  targetProjectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/teams/[id]/workspace-report/save
 * Save team workspace report markdown into a team project.
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

    const { id: teamId } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const report = await resolveTeamWorkspaceReport(teamId, session.user.id)
    if (!report.isMember) {
      return NextResponse.json(
        { error: "Not a team member", code: "NOT_TEAM_MEMBER" },
        { status: 403 }
      )
    }
    if (!report.found) {
      return NextResponse.json(
        { error: "Team not found", code: "TEAM_NOT_FOUND" },
        { status: 404 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: {
        userId: session.user.id,
        project: {
          teamId
        }
      },
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
        { error: "No project membership in team", code: "NO_PROJECT_MEMBERSHIP" },
        { status: 400 }
      )
    }

    const roleHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const editableMemberships = memberships.filter(
      (item) => roleHierarchy[item.role] >= roleHierarchy[ProjectRole.EDITOR]
    )
    if (editableMemberships.length === 0) {
      return NextResponse.json(
        { error: "No editable project in this team", code: "NO_EDITABLE_PROJECT" },
        { status: 403 }
      )
    }

    const targetMembership = parsed.data.targetProjectId
      ? editableMemberships.find((item) => item.projectId === parsed.data.targetProjectId)
      : editableMemberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found or not editable", code: "TARGET_PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const markdown = buildTeamWorkspaceMarkdown(report.payload)
    const timestamp = report.payload.generatedAt.replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `team-workspace-report-${timestamp}.md`
    const file = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TEAM_WORKSPACE_REPORT",
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
        fileId: file.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "TEAM_WORKSPACE_REPORT_SAVED",
          teamId: report.payload.team.id,
          teamName: report.payload.team.name,
          fileName: file.name
        }
      }
    })

    return NextResponse.json({
      message: "Team workspace report saved",
      file
    })
  } catch (error) {
    console.error("Save team workspace report error:", error)
    return NextResponse.json(
      { error: "Failed to save team workspace report", code: "TEAM_WORKSPACE_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
