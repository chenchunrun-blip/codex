import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { sendTeamInvitationEmail } from "@/lib/email/send-notification"

// Get all members of a team
export async function GET(
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

    // Check if user is a member of the team
    const team = await db.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true
              }
            }
          }
        }
      }
    })

    if (!team) {
      return NextResponse.json(
        { error: "Team not found", code: "TEAM_NOT_FOUND" },
        { status: 404 }
      )
    }

    const isMember = team.members.some(m => m.userId === session.user.id)
    if (!isMember) {
      return NextResponse.json(
        { error: "You don't have access to this team", code: "TEAM_ACCESS_DENIED" },
        { status: 403 }
      )
    }

    return NextResponse.json(team.members)
  } catch (error) {
    console.error("Failed to fetch team members:", error)
    return NextResponse.json(
      { error: "Failed to fetch team members", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

// Add a member to a team
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

    const { userId, role = 'MEMBER' } = await req.json().catch(() => ({}))

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Check if the requester is an admin of the team
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

    const requesterMembership = team.members.find(m => m.userId === session.user.id)
    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: "Only team admins can add members", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Check if user is already a member
    const existingMember = team.members.find(m => m.userId === userId)
    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this team", code: "MEMBER_ALREADY_EXISTS" },
        { status: 400 }
      )
    }

    // Add member to team
    const membership = await db.teamMember.create({
      data: {
        teamId,
        userId,
        role: role as 'ADMIN' | 'MEMBER'
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true
          }
        }
      }
    })

    // Notify the new member
    await db.notification.create({
      data: {
        userId: userId,
        type: 'TEAM_INVITATION',
        title: '🎉 Added to Team',
        content: `${session.user.name || session.user.email} added you to this team`,
        link: `/teams/${teamId}`
      }
    })

    // Send email to the new member
    await sendTeamInvitationEmail(
      membership.user.email,
      session.user.name || session.user.email || 'Administrator',
      session.user.email || '',
      team.name,
      teamId
    )

    // Notify existing members about new member
    const existingMembers = await db.teamMember.findMany({
      where: {
        teamId,
        userId: { not: userId } // Don't notify the new member
      },
      select: {
        user: {
          select: { id: true }
        }
      }
    })

    for (const member of existingMembers) {
      await db.notification.create({
        data: {
          userId: member.user.id,
          type: 'TEAM_INVITATION',
          title: '👥 New Team Member',
          content: `${membership.user.name || membership.user.email} was added to the team`,
          link: `/teams/${teamId}`
        }
      })
    }

    return NextResponse.json(membership)
  } catch (error) {
    console.error("Failed to add team member:", error)
    return NextResponse.json(
      { error: "Failed to add team member", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
