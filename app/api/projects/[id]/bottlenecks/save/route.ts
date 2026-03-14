import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  buildProjectBottlenecksMarkdown,
  resolveProjectBottlenecks
} from "@/lib/tasks/project-bottlenecks"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"

/**
 * POST /api/projects/[id]/bottlenecks/save
 * Persist bottlenecks report as a markdown project file.
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

    const generatedAt = new Date().toISOString()
    const reportData = await resolveProjectBottlenecks(id)
    const markdown = buildProjectBottlenecksMarkdown({
      projectId: id,
      generatedAt,
      data: reportData
    })

    const storageId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    const timestamp = generatedAt.replace(/[:.]/g, "-")
    const file = await db.file.create({
      data: {
        name: `project-bottlenecks-${timestamp}.md`,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: project.name,
        templateType: "PROJECT_BOTTLENECKS_REPORT",
        creatorId: session.user.id,
        projectId: project.id,
        storageId
      },
      select: {
        id: true,
        name: true,
        createdAt: true
      }
    })

    await db.activityLog.create({
      data: {
        projectId: project.id,
        fileId: file.id,
        userId: session.user.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "PROJECT_BOTTLENECKS_REPORT_FILE_CREATED",
          generatedAt
        }
      }
    })

    return NextResponse.json(
      {
        file,
        generatedAt
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Save bottlenecks report error:", error)
    return NextResponse.json(
      { error: "Failed to save bottlenecks report", code: "BOTTLENECKS_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
