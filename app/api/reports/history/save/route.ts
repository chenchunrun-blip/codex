import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { queryReportsHistory } from "@/lib/reports/history-query"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  targetProjectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional(),
  type: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

/**
 * POST /api/reports/history/save
 * Save filtered reports history as markdown file in a target project.
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

    const typeFilter = parsed.data.type?.trim() || ""
    const q = parsed.data.q?.trim().toLowerCase() || ""
    const projectFilter = parsed.data.projectId?.trim() || ""
    const limit = parsed.data.limit || 50
    const page = parsed.data.page || 1
    const offset = (page - 1) * limit

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
    const targetMembership = parsed.data.targetProjectId
      ? memberships.find((item) => item.projectId === parsed.data.targetProjectId)
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
    const scopedProjectIds = projectFilter
      ? accessibleProjectIds.has(projectFilter)
        ? [projectFilter]
        : []
      : Array.from(accessibleProjectIds)

    const history = await queryReportsHistory({
      projectIds: scopedProjectIds,
      typeFilter,
      q,
      limit,
      offset
    })

    const lines: string[] = []
    lines.push("# Reports History")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Records: ${history.length}`)
    if (typeFilter) lines.push(`- Type Filter: ${typeFilter}`)
    if (projectFilter) lines.push(`- Project Filter: ${projectFilter}`)
    if (q) lines.push(`- Search: ${q}`)
    if (page > 1) lines.push(`- Page: ${page}`)
    lines.push("")
    lines.push("| Time | Type | Project | Actor | File |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const item of history) {
      lines.push(
        `| ${item.createdAt} | ${item.type} | ${item.projectName.replace(/\|/g, "\\|")} | ${item.actorName.replace(/\|/g, "\\|")} | ${item.fileName.replace(/\|/g, "\\|")}${item.fileId ? ` (${item.fileId})` : ""} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `reports-history-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "REPORTS_HISTORY",
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
          type: "REPORTS_HISTORY_SAVED",
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Reports history saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save reports history error:", error)
    return NextResponse.json(
      { error: "Failed to save reports history", code: "REPORTS_HISTORY_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
