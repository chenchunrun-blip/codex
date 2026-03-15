import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  DEFAULT_PROJECT_SCHEDULER_CONFIG,
  normalizeSchedulerConfig,
  resolveProjectSchedulerConfig
} from "@/lib/tasks/scheduler-config"
import { ActionType, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const schedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  defaultLimit: z.number().int().min(1).max(20).optional(),
  defaultAutoSubmit: z.boolean().optional(),
  resetToDefault: z.boolean().optional().default(false)
})

/**
 * GET /api/projects/[id]/scheduler-config
 * Requires: project membership
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user!.id
        }
      }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const config = await resolveProjectSchedulerConfig(id)
    return NextResponse.json({
      projectId: id,
      ...config
    })
  } catch (error) {
    console.error("Scheduler config fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch scheduler config", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/projects/[id]/scheduler-config
 * Requires: EDITOR+ role on project
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = schedulerConfigSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user!.id
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

    const normalizedConfig = parsed.data.resetToDefault
      ? { ...DEFAULT_PROJECT_SCHEDULER_CONFIG }
      : normalizeSchedulerConfig({
          enabled: parsed.data.enabled,
          defaultLimit: parsed.data.defaultLimit,
          defaultAutoSubmit: parsed.data.defaultAutoSubmit
        })

    await db.activityLog.create({
      data: {
        projectId: id,
        taskId: null,
        userId: session.user!.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "PROJECT_SCHEDULER_CONFIG_UPDATED",
          ...normalizedConfig,
          resetToDefault: parsed.data.resetToDefault
        }
      }
    })

    return NextResponse.json({
      projectId: id,
      ...normalizedConfig,
      updatedAt: new Date().toISOString(),
      source: "project"
    })
  } catch (error) {
    console.error("Scheduler config update error:", error)
    return NextResponse.json(
      { error: "Failed to update scheduler config", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
