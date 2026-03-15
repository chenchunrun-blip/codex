import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(100),
  role: z.enum(["ADMIN", "MEMBER"]).optional().default("MEMBER")
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
        { error: "Only team admins can add members", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const normalizedEmails = Array.from(
      new Set(parsed.data.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))
    )
    const users = await db.user.findMany({
      where: {
        email: { in: normalizedEmails }
      },
      select: {
        id: true,
        email: true
      }
    })
    const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]))
    const existingMemberUserIds = new Set(team.members.map((member) => member.userId))
    const createData = users
      .filter((user) => !existingMemberUserIds.has(user.id))
      .map((user) => ({
        teamId,
        userId: user.id,
        role: parsed.data.role
      }))

    if (createData.length > 0) {
      await db.teamMember.createMany({
        data: createData,
        skipDuplicates: true
      })
      await db.notification.createMany({
        data: createData.map((item) => ({
          userId: item.userId,
          type: "TEAM_INVITATION",
          title: "🎉 Added to Team",
          content: `${session.user!.name || session.user!.email} added you to this team`,
          link: `/teams/${teamId}`
        })),
        skipDuplicates: false
      })
    }

    const addedEmailSet = new Set(
      createData
        .map((item) => users.find((user) => user.id === item.userId)?.email?.toLowerCase())
        .filter((value): value is string => Boolean(value))
    )
    const alreadyMemberEmails = normalizedEmails.filter((email) => {
      const user = userByEmail.get(email)
      return Boolean(user && existingMemberUserIds.has(user.id))
    })
    const notFoundEmails = normalizedEmails.filter((email) => !userByEmail.has(email))

    return NextResponse.json({
      role: parsed.data.role,
      addedCount: addedEmailSet.size,
      alreadyMemberCount: alreadyMemberEmails.length,
      notFoundCount: notFoundEmails.length,
      addedEmails: Array.from(addedEmailSet),
      alreadyMemberEmails,
      notFoundEmails
    })
  } catch (error) {
    console.error("Bulk add team members failed:", error)
    return NextResponse.json(
      { error: "Failed to bulk add team members", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
