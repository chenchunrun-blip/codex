import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

// Update member role
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: teamId, userId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { role } = await req.json().catch(() => ({}))

    if (!role || !['ADMIN', 'MEMBER'].includes(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be ADMIN or MEMBER", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Check if requester is admin
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
        { error: "Only team admins can update member roles", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Prevent removing admin role from the last admin
    const targetMembership = team.members.find(m => m.userId === userId)
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Member not found", code: "TEAM_MEMBER_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (targetMembership.role === 'ADMIN' && role === 'MEMBER') {
      const adminCount = team.members.filter(m => m.role === 'ADMIN').length
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove admin role from the last admin", code: "TEAM_LAST_ADMIN_CONSTRAINT" },
          { status: 400 }
        )
      }
    }

    // Update member role
    const updatedMembership = await db.teamMember.update({
      where: {
        teamId_userId: {
          teamId,
          userId
        }
      },
      data: { role },
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

    return NextResponse.json(updatedMembership)
  } catch (error) {
    console.error("Failed to update team member:", error)
    return NextResponse.json(
      { error: "Failed to update team member", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

// Remove member from team
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: teamId, userId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Check if requester is admin
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
        { error: "Only team admins can remove members", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Prevent removing the last admin
    const targetMembership = team.members.find(m => m.userId === userId)
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Member not found", code: "TEAM_MEMBER_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (targetMembership.role === 'ADMIN') {
      const adminCount = team.members.filter(m => m.role === 'ADMIN').length
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last admin from the team", code: "TEAM_LAST_ADMIN_CONSTRAINT" },
          { status: 400 }
        )
      }
    }

    // Remove member
    await db.teamMember.delete({
      where: {
        teamId_userId: {
          teamId,
          userId
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to remove team member:", error)
    return NextResponse.json(
      { error: "Failed to remove team member", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
