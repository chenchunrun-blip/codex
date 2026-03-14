import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  buildOperationsStatusMarkdown,
  resolveOperationsStatus
} from "@/lib/operations/status"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceProjectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/operations/status/save
 * Save operations status report as markdown in target project.
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
    if (parsed.data.sourceProjectId && !accessibleProjectIds.has(parsed.data.sourceProjectId)) {
      return NextResponse.json(
        { error: "Source project not found in your memberships", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const status = await resolveOperationsStatus({
      projectIds: Array.from(accessibleProjectIds),
      sourceProjectId: parsed.data.sourceProjectId
    })

    const markdown = buildOperationsStatusMarkdown(status)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `operations-status-${timestamp}.md`

    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "OPERATIONS_STATUS_REPORT",
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
          type: "OPERATIONS_STATUS_REPORT_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Operations status report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save operations status report error:", error)
    return NextResponse.json(
      { error: "Failed to save operations status report", code: "OPERATIONS_STATUS_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
