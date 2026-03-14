import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1),
  reportType: z.enum(["PROJECT_BULK_STARTER_PACK_REPORT_SAVED", "PROJECT_BULK_SCHEDULER_REPORT_SAVED"]),
  content: z.string().min(1),
  fileName: z.string().min(1).max(160).optional()
})

const roleHierarchy: Record<ProjectRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2
}

/**
 * POST /api/projects/bulk-run-report/save
 * Save bulk-runner markdown report into a project file and log report metadata for Reports Hub history.
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

    const { projectId, reportType, content } = parsed.data

    const membership = await db.projectMember.findFirst({
      where: {
        projectId,
        userId: session.user.id
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
    if (!membership) {
      return NextResponse.json(
        { error: "Project not found in your memberships", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (roleHierarchy[membership.role] < roleHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const baseName =
      reportType === "PROJECT_BULK_STARTER_PACK_REPORT_SAVED"
        ? "bulk-starter-pack-runner-report"
        : "bulk-scheduler-runner-report"
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `${baseName}-${stamp}.md`

    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: membership.project.name,
        templateType: reportType,
        creatorId: session.user.id,
        projectId: membership.project.id,
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
        projectId: membership.project.id,
        fileId: reportFile.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: reportType,
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Bulk run report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save bulk run report error:", error)
    return NextResponse.json(
      { error: "Failed to save bulk run report", code: "BULK_RUN_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}

