import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  sourceProjectId: z.string().min(1).optional(),
  targetProjectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(200).optional()
})

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

/**
 * POST /api/projects/starter-files/history/save
 * Save project starter rollout history report into target project.
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
    const editableMemberships = memberships.filter(
      (item) => roleHierarchy[item.role] >= roleHierarchy[ProjectRole.EDITOR]
    )
    if (editableMemberships.length === 0) {
      return NextResponse.json(
        { error: "No editable project membership found", code: "NO_EDITABLE_PROJECT" },
        { status: 403 }
      )
    }

    const sourceMembership = parsed.data.sourceProjectId
      ? memberships.find((item) => item.projectId === parsed.data.sourceProjectId)
      : memberships[0]
    if (!sourceMembership) {
      return NextResponse.json(
        { error: "Source project not found", code: "SOURCE_PROJECT_NOT_FOUND" },
        { status: 404 }
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

    const limit = parsed.data.limit || 50
    const logs = await db.activityLog.findMany({
      where: {
        projectId: sourceMembership.projectId,
        taskId: null,
        action: ActionType.TASK_UPDATED
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 3, 120),
      select: {
        createdAt: true,
        metadata: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    const history = logs
      .filter((row) => {
        const type = metadataType(row.metadata)
        return type === "PROJECT_STARTER_PACK_APPLIED" || type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED"
      })
      .map((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>
        const packName = typeof metadata.packName === "string" ? metadata.packName : null
        const packId = typeof metadata.packId === "string" ? metadata.packId : null
        const templateName = typeof metadata.templateName === "string" ? metadata.templateName : null
        const templateId = typeof metadata.templateId === "string" ? metadata.templateId : null
        const templateCategory =
          typeof metadata.templateCategory === "string" ? metadata.templateCategory : null
        const artifactLabel = packName || packId || templateName || templateId || "-"
        return {
          createdAt: row.createdAt.toISOString(),
          artifactLabel,
          templateCategory,
          scope: typeof metadata.scope === "string" ? metadata.scope : "single",
          dryRun: metadata.dryRun === true,
          createdCount: typeof metadata.createdCount === "number" ? metadata.createdCount : 0,
          wouldCreateCount:
            typeof metadata.wouldCreateCount === "number" ? metadata.wouldCreateCount : 0,
          skippedCount: typeof metadata.skippedCount === "number" ? metadata.skippedCount : 0,
          actorName: row.user?.name || row.user?.email || "Unknown user"
        }
      })
      .slice(0, limit)

    const lines: string[] = []
    lines.push(`# Project Starter Rollout History - ${sourceMembership.project.name}`)
    lines.push("")
    lines.push(`- Source Project ID: ${sourceMembership.project.id}`)
    lines.push(`- Source Project Name: ${sourceMembership.project.name}`)
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Records: ${history.length}`)
    lines.push("")
    lines.push("| Time | Artifact | Scope | Result | Skipped | Actor |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const item of history) {
      const result = item.dryRun
        ? `dry-run (wouldCreate=${item.wouldCreateCount})`
        : `created=${item.createdCount}`
      const artifact =
        item.templateCategory && item.templateCategory.length > 0
          ? `${item.artifactLabel} (${item.templateCategory})`
          : item.artifactLabel
      lines.push(
        `| ${item.createdAt} | ${String(artifact).replace(/\|/g, "\\|")} | ${item.scope} | ${result} | ${item.skippedCount} | ${item.actorName.replace(/\|/g, "\\|")} |`
      )
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `project-starter-rollout-history-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: lines.join("\n"),
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "PROJECT_STARTER_PACK_HISTORY",
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
          type: "PROJECT_STARTER_PACK_HISTORY_SAVED",
          sourceProjectId: sourceMembership.project.id,
          sourceProjectName: sourceMembership.project.name,
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Project starter rollout history saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save project starter history error:", error)
    return NextResponse.json(
      { error: "Failed to save project starter history", code: "PROJECT_STARTER_HISTORY_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
