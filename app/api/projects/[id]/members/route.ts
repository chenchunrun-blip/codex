import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { sendProjectInvitationEmail } from "@/lib/email/send-notification"

// Get all members of a project
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    // Check if user has access to the project
    const project = await db.project.findUnique({
      where: { id: projectId },
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

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    const hasAccess = project.members.some(m => m.userId === session.user.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You don't have access to this project" },
        { status: 403 }
      )
    }

    return NextResponse.json(project.members)
  } catch (error) {
    console.error("Failed to fetch project members:", error)
    return NextResponse.json(
      { error: "Failed to fetch project members" },
      { status: 500 }
    )
  }
}

// Add a member to a project
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    const { userId, role = 'MEMBER' } = await req.json()

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      )
    }

    // Check if requester is admin or editor of the project
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        members: true,
        team: true
      }
    })

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    const requesterMembership = project.members.find(m => m.userId === session.user.id)
    if (!requesterMembership || requesterMembership.role === 'VIEWER') {
      return NextResponse.json(
        { error: "Only editors and admins can add members" },
        { status: 403 }
      )
    }

    // Check if user is already a member
    const existingMember = project.members.find(m => m.userId === userId)
    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of this project" },
        { status: 400 }
      )
    }

    // Add member to project
    const membership = await db.projectMember.create({
      data: {
        projectId,
        userId,
        role: role as 'ADMIN' | 'EDITOR' | 'VIEWER'
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

    // Log activity
    await db.activityLog.create({
      data: {
        projectId,
        userId: session.user.id,
        action: "MEMBER_ADDED",
        metadata: { addedUser: membership.user.name || membership.user.email }
      }
    })

    // Notify the new member
    await db.notification.create({
      data: {
        userId: userId,
        type: 'TEAM_INVITATION',
        title: '🎉 Added to Project',
        content: `${session.user.name || session.user.email} added you to this project`,
        link: `/projects/${projectId}`
      }
    })

    // Send email to the new member
    await sendProjectInvitationEmail(
      membership.user.email,
      session.user.name || session.user.email || 'Administrator',
      session.user.email || '',
      project.name,
      project.team.name,
      projectId
    )

    // Notify existing members about new member
    const existingMembers = await db.projectMember.findMany({
      where: {
        projectId,
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
          title: '👥 New Project Member',
          content: `${membership.user.name || membership.user.email} was added to the project`,
          link: `/projects/${projectId}`
        }
      })
    }

    return NextResponse.json(membership)
  } catch (error) {
    console.error("Failed to add project member:", error)
    return NextResponse.json(
      { error: "Failed to add project member" },
      { status: 500 }
    )
  }
}
