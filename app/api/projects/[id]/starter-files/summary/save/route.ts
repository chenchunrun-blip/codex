import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  fileName: z.string().min(1).max(120).optional()
})

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function summarize(
  logs: Array<{
    createdAt: Date
    metadata: unknown
  }>,
  days: number
) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  let runs = 0
  let packRuns = 0
  let templateRuns = 0
  let dryRuns = 0
  let createdTotal = 0
  let skippedTotal = 0

  for (const row of logs) {
    if (row.createdAt.getTime() < since) continue
    const type = metadataType(row.metadata)
    if (type !== "PROJECT_STARTER_PACK_APPLIED" && type !== "PROJECT_TEMPLATE_ROLLOUT_APPLIED") continue
    const metadata = (row.metadata || {}) as Record<string, unknown>
    runs += 1
    if (type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED") templateRuns += 1
    else packRuns += 1
    if (metadata.dryRun === true) dryRuns += 1
    createdTotal += asNumber(metadata.createdCount)
    skippedTotal += asNumber(metadata.skippedCount)
  }

  return { days, runs, packRuns, templateRuns, dryRuns, createdTotal, skippedTotal }
}

/**
 * POST /api/projects/[id]/starter-files/summary/save
 * Save project starter rollout summary markdown into current project.
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

    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const { id } = await params
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user.id
        }
      },
      select: {
        role: true,
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

    const logs = await db.activityLog.findMany({
      where: {
        projectId: id,
        taskId: null,
        action: ActionType.TASK_UPDATED
      },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        createdAt: true,
        metadata: true
      }
    })

    const filtered = logs.filter((row) => {
      const type = metadataType(row.metadata)
      return type === "PROJECT_STARTER_PACK_APPLIED" || type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED"
    })
    const summary7d = summarize(filtered, 7)
    const summary30d = summarize(filtered, 30)

    const recent = filtered.slice(0, 10).map((row) => {
      const metadata = (row.metadata || {}) as Record<string, unknown>
      const type = metadataType(row.metadata)
      const artifact =
        (typeof metadata.packName === "string" && metadata.packName) ||
        (typeof metadata.packId === "string" && metadata.packId) ||
        (typeof metadata.templateName === "string" && metadata.templateName) ||
        (typeof metadata.templateId === "string" && metadata.templateId) ||
        "Artifact"
      const result = metadata.dryRun === true
        ? `dry-run (wouldCreate=${asNumber(metadata.wouldCreateCount)})`
        : `created=${asNumber(metadata.createdCount)}`
      return `- ${row.createdAt.toISOString()} | ${type === "PROJECT_TEMPLATE_ROLLOUT_APPLIED" ? "TEMPLATE" : "PACK"}:${artifact} | ${result} | skipped=${asNumber(metadata.skippedCount)}`
    })

    const generatedAt = new Date()
    const markdown = [
      `# Project Starter Rollout Summary - ${membership.project.name}`,
      "",
      `- Generated At: ${generatedAt.toISOString()}`,
      `- Project ID: ${membership.project.id}`,
      "",
      "## Last 7 Days",
      `- Runs: ${summary7d.runs}`,
      `- Pack Runs: ${summary7d.packRuns}`,
      `- Template Runs: ${summary7d.templateRuns}`,
      `- Dry Runs: ${summary7d.dryRuns}`,
      `- Created: ${summary7d.createdTotal}`,
      `- Skipped: ${summary7d.skippedTotal}`,
      "",
      "## Last 30 Days",
      `- Runs: ${summary30d.runs}`,
      `- Pack Runs: ${summary30d.packRuns}`,
      `- Template Runs: ${summary30d.templateRuns}`,
      `- Dry Runs: ${summary30d.dryRuns}`,
      `- Created: ${summary30d.createdTotal}`,
      `- Skipped: ${summary30d.skippedTotal}`,
      "",
      "## Recent 10 Rollout Runs",
      ...(recent.length > 0 ? recent : ["- None"])
    ].join("\n")

    const fileName =
      parsed.data.fileName || `project-starter-rollout-summary-${generatedAt.toISOString().replace(/[:.]/g, "-")}.md`
    const file = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: membership.project.name,
        templateType: "PROJECT_STARTER_ROLLOUT_SUMMARY",
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
        fileId: file.id,
        action: ActionType.FILE_CREATED,
        metadata: {
          type: "PROJECT_STARTER_ROLLOUT_SUMMARY_SAVED",
          sourceProjectId: membership.project.id,
          sourceProjectName: membership.project.name,
          summary7d,
          summary30d,
          fileName: file.name
        }
      }
    })

    return NextResponse.json(
      {
        message: "Project starter rollout summary saved",
        file
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Save project starter rollout summary error:", error)
    return NextResponse.json(
      {
        error: "Failed to save project starter rollout summary",
        code: "PROJECT_STARTER_ROLLOUT_SUMMARY_SAVE_FAILED"
      },
      { status: 500 }
    )
  }
}
