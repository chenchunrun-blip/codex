import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  AVAILABLE_RETRYABLE_ERROR_CODES,
  DEFAULT_RETRYABLE_ERROR_CODES,
  normalizeRetryableCodes,
  resolveProjectRetryableCodes
} from "@/lib/tasks/retryable-codes"
import { ActionType, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const retryConfigSchema = z.object({
  retryableErrorCodes: z.array(z.string()).min(1).max(20).optional(),
  resetToDefault: z.boolean().optional().default(false)
}).superRefine((value, ctx) => {
  if (!value.resetToDefault && (!value.retryableErrorCodes || value.retryableErrorCodes.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "retryableErrorCodes is required when resetToDefault is false",
      path: ["retryableErrorCodes"]
    })
  }
})

/**
 * GET /api/projects/[id]/retry-config
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

    const config = await resolveProjectRetryableCodes(id)
    return NextResponse.json({
      projectId: id,
      retryableErrorCodes: config.retryableErrorCodes,
      availableRetryableErrorCodes: AVAILABLE_RETRYABLE_ERROR_CODES,
      updatedAt: config.updatedAt,
      source: config.source
    })
  } catch (error) {
    console.error("Retry config fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch retry config", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/projects/[id]/retry-config
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
    const parsed = retryConfigSchema.safeParse(body)
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

    const normalizedCodes = parsed.data.resetToDefault
      ? [...DEFAULT_RETRYABLE_ERROR_CODES]
      : normalizeRetryableCodes(parsed.data.retryableErrorCodes)
    await db.activityLog.create({
      data: {
        projectId: id,
        taskId: null,
        userId: session.user!.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "PROJECT_RETRYABLE_ERROR_CODES_UPDATED",
          retryableErrorCodes: normalizedCodes,
          resetToDefault: parsed.data.resetToDefault
        }
      }
    })

    return NextResponse.json({
      projectId: id,
      retryableErrorCodes: normalizedCodes,
      availableRetryableErrorCodes: AVAILABLE_RETRYABLE_ERROR_CODES,
      updatedAt: new Date().toISOString(),
      source: "project"
    })
  } catch (error) {
    console.error("Retry config update error:", error)
    return NextResponse.json(
      { error: "Failed to update retry config", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
