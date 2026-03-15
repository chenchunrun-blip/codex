import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  targetProjectId: z.string().min(1).optional(),
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
    if (type !== "TEAM_STARTER_PACK_APPLIED" && type !== "TEAM_TEMPLATE_ROLLOUT_APPLIED") continue
    const metadata = (row.metadata || {}) as Record<string, unknown>
    runs += 1
    if (type === "TEAM_TEMPLATE_ROLLOUT_APPLIED") templateRuns += 1
    else packRuns += 1
    if (metadata.dryRun === true) dryRuns += 1
    createdTotal += asNumber(metadata.createdCount)
    skippedTotal += asNumber(metadata.skippedCount)
  }

  return { days, runs, packRuns, templateRuns, dryRuns, createdTotal, skippedTotal }
}

/**
 * POST /api/teams/[id]/starter-files/summary/save
 * Save team starter rollout summary markdown into a team project.
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

    const { id: teamId } = await params
    const teamMembership = await db.teamMember.findFirst({
      where: {
        teamId,
        userId: session.user.id
      },
      select: { id: true }
    })
    if (!teamMembership) {
      return NextResponse.json(
        { error: "Not a team member", code: "NOT_TEAM_MEMBER" },
        { status: 403 }
      )
    }

    const team = await db.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true }
    })
    if (!team) {
      return NextResponse.json(
        { error: "Team not found", code: "TEAM_NOT_FOUND" },
        { status: 404 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: {
        userId: session.user.id,
        project: { teamId }
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

    const logs = await db.activityLog.findMany({
      where: {
        taskId: null,
        action: ActionType.TASK_UPDATED,
        project: {
          teamId
        }
      },
      orderBy: { createdAt: "desc" },
      take: 600,
      select: {
        createdAt: true,
        projectId: true,
        metadata: true,
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    const filtered = logs.filter((row) => {
      const type = metadataType(row.metadata)
      return type === "TEAM_STARTER_PACK_APPLIED" || type === "TEAM_TEMPLATE_ROLLOUT_APPLIED"
    })
    const summary7d = summarize(filtered, 7)
    const summary30d = summarize(filtered, 30)

    const recentProjectCounts = new Map<string, { projectName: string; runs: number }>()
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const row of filtered) {
      if (row.createdAt.getTime() < since7d) continue
      const key = row.projectId || "unknown"
      const current = recentProjectCounts.get(key) || {
        projectName: row.project?.name || row.projectId || "Unknown project",
        runs: 0
      }
      current.runs += 1
      recentProjectCounts.set(key, current)
    }
    const topProjects = Array.from(recentProjectCounts.values())
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 10)

    const generatedAt = new Date()
    const markdown = [
      `# Team Starter Rollout Summary - ${team.name}`,
      "",
      `- Generated At: ${generatedAt.toISOString()}`,
      `- Team ID: ${teamId}`,
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
      "## Top Projects by Runs (Last 7 Days)",
      ...(topProjects.length > 0
        ? topProjects.map((item) => `- ${item.projectName}: ${item.runs}`)
        : ["- None"])
    ].join("\n")

    const fileName =
      parsed.data.fileName || `team-starter-rollout-summary-${generatedAt.toISOString().replace(/[:.]/g, "-")}.md`
    const file = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "TEAM_STARTER_ROLLOUT_SUMMARY",
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
          type: "TEAM_STARTER_ROLLOUT_SUMMARY_SAVED",
          teamId: team.id,
          teamName: team.name,
          summary7d,
          summary30d,
          fileName: file.name
        }
      }
    })

    return NextResponse.json({
      message: "Team starter rollout summary saved",
      file
    })
  } catch (error) {
    console.error("Save team starter rollout summary error:", error)
    return NextResponse.json(
      {
        error: "Failed to save team starter rollout summary",
        code: "TEAM_STARTER_ROLLOUT_SUMMARY_SAVE_FAILED"
      },
      { status: 500 }
    )
  }
}
