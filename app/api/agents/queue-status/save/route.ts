import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { resolveAgentQueueStatus } from "@/lib/agents/queue-status"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  targetProjectId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional()
})

function buildMarkdown(input: {
  generatedAt: string
  sourceProjectId: string | null
  domains: Array<{
    domain: string
    backlog: number
    activeAgents: number
    onlineAgents: number
  }>
}) {
  const lines: string[] = []
  lines.push("# Agent Queue Status Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt}`)
  lines.push(`- Source Project: ${input.sourceProjectId || "ALL"}`)
  lines.push(`- Domains: ${input.domains.length}`)
  lines.push("")
  lines.push("| Domain | Backlog | Online Agents | Active Agents | Risk |")
  lines.push("| --- | --- | --- | --- | --- |")
  for (const row of input.domains) {
    const risk = row.backlog > 0 && row.onlineAgents === 0 ? "AT_RISK" : "OK"
    lines.push(`| ${row.domain} | ${row.backlog} | ${row.onlineAgents} | ${row.activeAgents} | ${risk} |`)
  }
  return lines.join("\n")
}

/**
 * POST /api/agents/queue-status/save
 * Save queue status report as markdown file.
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

    const targetMembership = parsed.data.targetProjectId
      ? editableMemberships.find((item) => item.projectId === parsed.data.targetProjectId)
      : editableMemberships[0]
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Target project not found or not editable", code: "TARGET_PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const sourceProjectId = parsed.data.projectId?.trim() || null
    if (sourceProjectId && !memberships.some((item) => item.projectId === sourceProjectId)) {
      return NextResponse.json(
        { error: "Source project not found in memberships", code: "SOURCE_PROJECT_NOT_FOUND" },
        { status: 404 }
      )
    }

    const queueStatus = await resolveAgentQueueStatus(sourceProjectId || undefined)
    const generatedAt = new Date().toISOString()
    const markdown = buildMarkdown({
      generatedAt,
      sourceProjectId: queueStatus.projectId,
      domains: queueStatus.domains
    })

    const timestamp = generatedAt.replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `agent-queue-status-${timestamp}.md`
    const file = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "AGENT_QUEUE_STATUS_REPORT",
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
          type: "AGENT_QUEUE_STATUS_SAVED",
          sourceProjectId: queueStatus.projectId,
          fileName: file.name
        }
      }
    })

    return NextResponse.json({
      message: "Agent queue status report saved",
      file
    })
  } catch (error) {
    console.error("Save queue status report error:", error)
    return NextResponse.json(
      { error: "Failed to save queue status report", code: "AGENT_QUEUE_STATUS_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
