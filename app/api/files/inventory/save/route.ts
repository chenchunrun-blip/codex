import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  sourceProjectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

/**
 * POST /api/files/inventory/save
 * Save workspace files inventory report to a project markdown file.
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

    const editableHierarchy: Record<ProjectRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
    const targetMembership = parsed.data.projectId
      ? memberships.find((item) => item.projectId === parsed.data.projectId)
      : memberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found in your memberships", code: "PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (editableHierarchy[targetMembership.role] < editableHierarchy[ProjectRole.EDITOR]) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const accessibleProjectIds = memberships.map((item) => item.projectId)
    const sourceProjectIds =
      parsed.data.sourceProjectId && accessibleProjectIds.includes(parsed.data.sourceProjectId)
        ? [parsed.data.sourceProjectId]
        : accessibleProjectIds

    const files = await db.file.findMany({
      where: {
        projectId: { in: sourceProjectIds }
      },
      select: {
        id: true,
        name: true,
        fileType: true,
        status: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 300
    })

    const fileIds = files.map((file) => file.id)
    const taskLinkLogs = fileIds.length
      ? await db.activityLog.findMany({
          where: {
            action: ActionType.TASK_CREATED,
            fileId: { in: fileIds },
            taskId: { not: null }
          },
          select: {
            fileId: true,
            taskId: true
          }
        })
      : []
    const linkedTaskMap = new Map<string, Set<string>>()
    for (const log of taskLinkLogs) {
      if (!log.fileId || !log.taskId) continue
      if (!linkedTaskMap.has(log.fileId)) linkedTaskMap.set(log.fileId, new Set<string>())
      linkedTaskMap.get(log.fileId)!.add(log.taskId)
    }

    const lines: string[] = []
    lines.push("# Files Inventory Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Source Projects: ${sourceProjectIds.length}`)
    lines.push(`- Files: ${files.length}`)
    lines.push("")
    lines.push("| File | Project | Type | Status | Linked Tasks | Updated At |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const file of files) {
      const linkedTaskCount = linkedTaskMap.get(file.id)?.size || 0
      lines.push(
        `| ${file.name.replace(/\|/g, "\\|")} | ${file.project.name.replace(/\|/g, "\\|")} | ${file.fileType} | ${file.status} | ${linkedTaskCount} | ${file.updatedAt.toISOString()} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `files-inventory-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "FILES_INVENTORY_REPORT",
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
          type: "FILES_INVENTORY_REPORT_SAVED",
          sourceProjectId: parsed.data.sourceProjectId || null,
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Files inventory report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save files inventory report error:", error)
    return NextResponse.json(
      { error: "Failed to save files inventory report", code: "FILES_INVENTORY_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
