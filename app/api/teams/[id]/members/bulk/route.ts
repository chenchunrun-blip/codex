import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z
  .object({
    action: z.enum(["SET_ROLE", "REMOVE"]),
    userIds: z.array(z.string().min(1)).min(1),
    role: z.enum(["ADMIN", "MEMBER"]).optional()
  })
  .superRefine((value, ctx) => {
    if (value.action === "SET_ROLE" && !value.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: "role is required for SET_ROLE"
      })
    }
  })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: teamId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
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

    const uniqueUserIds = Array.from(new Set(parsed.data.userIds))
    const team = await db.team.findUnique({
      where: { id: teamId },
      include: {
        members: true
      }
    })

    if (!team) {
      return NextResponse.json(
        { error: "Team not found", code: "TEAM_NOT_FOUND" },
        { status: 404 }
      )
    }

    const requesterMembership = team.members.find((m) => m.userId === session.user!.id)
    if (!requesterMembership || requesterMembership.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only team admins can manage members", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const targetMembers = team.members.filter((m) => uniqueUserIds.includes(m.userId))
    if (targetMembers.length === 0) {
      return NextResponse.json(
        { error: "No valid team members in userIds", code: "TEAM_MEMBER_NOT_FOUND" },
        { status: 400 }
      )
    }

    const adminCount = team.members.filter((m) => m.role === "ADMIN").length
    const targetAdminCount = targetMembers.filter((m) => m.role === "ADMIN").length

    if (parsed.data.action === "SET_ROLE" && parsed.data.role === "MEMBER") {
      if (adminCount - targetAdminCount <= 0) {
        return NextResponse.json(
          { error: "Cannot remove admin role from all admins", code: "TEAM_LAST_ADMIN_CONSTRAINT" },
          { status: 400 }
        )
      }
    }

    if (parsed.data.action === "REMOVE") {
      if (adminCount - targetAdminCount <= 0) {
        return NextResponse.json(
          { error: "Cannot remove all admins from the team", code: "TEAM_LAST_ADMIN_CONSTRAINT" },
          { status: 400 }
        )
      }
    }

    if (parsed.data.action === "SET_ROLE") {
      await db.teamMember.updateMany({
        where: {
          teamId,
          userId: { in: targetMembers.map((member) => member.userId) }
        },
        data: {
          role: parsed.data.role
        }
      })

      return NextResponse.json({
        action: "SET_ROLE",
        role: parsed.data.role,
        total: targetMembers.length
      })
    }

    await db.teamMember.deleteMany({
      where: {
        teamId,
        userId: { in: targetMembers.map((member) => member.userId) }
      }
    })

    return NextResponse.json({
      action: "REMOVE",
      total: targetMembers.length
    })
  } catch (error) {
    console.error("Bulk team member update failed:", error)
    return NextResponse.json(
      { error: "Failed to update team members", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
