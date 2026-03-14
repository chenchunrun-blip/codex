import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { ActionType, FileStatus, FileTypeEnum, ProjectRole, TaskStatus } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(120).optional(),
  hours: z.number().int().min(1).max(168).optional()
})

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

function isOnline(updatedAt: Date) {
  return Date.now() - updatedAt.getTime() <= 5 * 60 * 1000
}

/**
 * POST /api/agents/workload/save
 * Save current agent workload report as markdown file in a project.
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

    const hours = parsed.data.hours || 24
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const [agents, tasksForAgents, runLogs] = await Promise.all([
      db.agent.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          isActive: true,
          updatedAt: true
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }]
      }),
      db.task.findMany({
        where: {
          projectId: targetMembership.project.id,
          agentId: { not: null }
        },
        select: {
          id: true,
          agentId: true,
          status: true
        }
      }),
      db.activityLog.findMany({
        where: {
          projectId: targetMembership.project.id,
          taskId: { not: null },
          action: ActionType.TASK_UPDATED,
          createdAt: { gte: since }
        },
        orderBy: { createdAt: "desc" },
        select: {
          taskId: true,
          metadata: true,
          createdAt: true
        }
      })
    ])

    const taskIds = Array.from(
      new Set(tasksForAgents.map((task) => task.id))
    )
    const queueBacklog = await db.task.count({
      where: {
        projectId: targetMembership.project.id,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
      }
    })
    const tasksByAgent = new Map<string, number>()
    for (const task of tasksForAgents) {
      if (!task.agentId) continue
      tasksByAgent.set(task.agentId, (tasksByAgent.get(task.agentId) || 0) + 1)
    }
    const taskIdSet = new Set(taskIds)
    const runStatsByAgent = new Map<string, { success: number; failed: number }>()
    const taskAgentMap = new Map(
      tasksForAgents
        .filter((item) => item.agentId)
        .map((item) => [item.id, item.agentId as string])
    )
    for (const log of runLogs) {
      if (!log.taskId || !taskIdSet.has(log.taskId)) continue
      const agentId = taskAgentMap.get(log.taskId)
      if (!agentId) continue
      const type = getMetadataType(log.metadata)
      if (type !== "AGENT_RUN_FAILED" && type !== "AGENT_RUN_TRIGGERED") continue
      if (!runStatsByAgent.has(agentId)) {
        runStatsByAgent.set(agentId, { success: 0, failed: 0 })
      }
      if (type === "AGENT_RUN_FAILED") {
        runStatsByAgent.get(agentId)!.failed += 1
      } else {
        runStatsByAgent.get(agentId)!.success += 1
      }
    }

    const lines: string[] = []
    lines.push(`# Agent Workload Report: ${targetMembership.project.name}`)
    lines.push("")
    lines.push(`- GeneratedAt: ${new Date().toISOString()}`)
    lines.push(`- Hours Window: ${hours}`)
    lines.push(`- Project ID: ${targetMembership.project.id}`)
    lines.push(`- Total Agents: ${agents.length}`)
    lines.push(`- Queue Backlog: ${queueBacklog}`)
    lines.push("")
    lines.push("| Agent | Active | Online | Assigned Tasks | Runs Success | Runs Failed | Last Active |")
    lines.push("| --- | --- | --- | --- | --- | --- | --- |")
    for (const agent of agents) {
      const runs = runStatsByAgent.get(agent.id) || { success: 0, failed: 0 }
      lines.push(
        `| ${(agent.displayName || agent.name).replace(/\|/g, "\\|")} | ${agent.isActive ? "yes" : "no"} | ${isOnline(agent.updatedAt) ? "yes" : "no"} | ${tasksByAgent.get(agent.id) || 0} | ${runs.success} | ${runs.failed} | ${agent.updatedAt.toISOString()} |`
      )
    }
    const markdown = lines.join("\n")

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = parsed.data.fileName || `agent-workload-report-${timestamp}.md`
    const reportFile = await db.file.create({
      data: {
        name: fileName,
        content: markdown,
        fileType: FileTypeEnum.CUSTOM,
        status: FileStatus.DRAFT,
        projectName: targetMembership.project.name,
        templateType: "AGENT_WORKLOAD_REPORT",
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
          type: "AGENT_WORKLOAD_REPORT_SAVED",
          hours,
          fileName: reportFile.name
        }
      }
    })

    return NextResponse.json({
      message: "Agent workload report saved",
      file: reportFile
    })
  } catch (error) {
    console.error("Save agent workload report error:", error)
    return NextResponse.json(
      { error: "Failed to save agent workload report", code: "AGENT_WORKLOAD_REPORT_SAVE_FAILED" },
      { status: 500 }
    )
  }
}
