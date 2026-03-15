import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

// Get team details
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

    const team = await db.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            projects: true
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

    // Check if user is a member
    const isMember = team.members.some(m => m.userId === session.user.id)
    if (!isMember) {
      return NextResponse.json(
        { error: "You don't have access to this team", code: "TEAM_ACCESS_DENIED" },
        { status: 403 }
      )
    }

    return NextResponse.json(team)
  } catch (error) {
    console.error("Failed to fetch team:", error)
    return NextResponse.json(
      { error: "Failed to fetch team", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

// Update team details
export async function PATCH(
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

    const { name, description } = await req.json().catch(() => ({}))

    // Check if user is admin
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

    const membership = team.members.find(m => m.userId === session.user.id)
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: "Only team admins can update team details", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Update team
    const updatedTeam = await db.team.update({
      where: { id: teamId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description })
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    return NextResponse.json(updatedTeam)
  } catch (error) {
    console.error("Failed to update team:", error)
    return NextResponse.json(
      { error: "Failed to update team", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

// Delete team
export async function DELETE(
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

    // Check if user is admin
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

    const membership = team.members.find(m => m.userId === session.user.id)
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: "Only team admins can delete the team", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Check if team has projects
    const projectCount = await db.project.count({
      where: { teamId }
    })

    if (projectCount > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete team with existing projects",
          code: "TEAM_HAS_PROJECTS",
          projectCount
        },
        { status: 400 }
      )
    }

    // Delete team (memberships will be deleted by cascade)
    await db.team.delete({
      where: { id: teamId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete team:", error)
    return NextResponse.json(
      { error: "Failed to delete team", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
