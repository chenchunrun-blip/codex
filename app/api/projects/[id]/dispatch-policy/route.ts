import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  DEFAULT_PROJECT_DISPATCH_POLICY,
  resolveProjectDispatchPolicy
} from "@/lib/tasks/dispatch-policy"
import { ActionType, ProjectRole } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"

const dispatchPolicySchema = z.object({
  onlineOnly: z.boolean().optional(),
  resetToDefault: z.boolean().optional().default(false)
}).superRefine((value, ctx) => {
  if (!value.resetToDefault && typeof value.onlineOnly !== "boolean") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "onlineOnly is required when resetToDefault is false",
      path: ["onlineOnly"]
    })
  }
})

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

    const policy = await resolveProjectDispatchPolicy(id)
    return NextResponse.json({
      projectId: id,
      onlineOnly: policy.onlineOnly,
      updatedAt: policy.updatedAt,
      source: policy.source
    })
  } catch (error) {
    console.error("Dispatch policy fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch dispatch policy", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = dispatchPolicySchema.safeParse(body)
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

    const onlineOnly = parsed.data.resetToDefault
      ? DEFAULT_PROJECT_DISPATCH_POLICY.onlineOnly
      : Boolean(parsed.data.onlineOnly)

    await db.activityLog.create({
      data: {
        projectId: id,
        taskId: null,
        userId: session.user!.id,
        action: ActionType.TASK_UPDATED,
        metadata: {
          type: "PROJECT_DISPATCH_POLICY_UPDATED",
          onlineOnly,
          resetToDefault: parsed.data.resetToDefault
        }
      }
    })

    return NextResponse.json({
      projectId: id,
      onlineOnly,
      updatedAt: new Date().toISOString(),
      source: "project"
    })
  } catch (error) {
    console.error("Dispatch policy update error:", error)
    return NextResponse.json(
      { error: "Failed to update dispatch policy", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

