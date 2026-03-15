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
    const { id: projectId, userId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    const { role } = await req.json()

    if (!role || !['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be ADMIN, EDITOR, or VIEWER" },
        { status: 400 }
      )
    }

    // Check if requester is admin
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        members: true
      }
    })

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    const requesterMembership = project.members.find(m => m.userId === session.user.id)
    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: "Only project admins can update member roles" },
        { status: 403 }
      )
    }

    // Prevent removing admin role from the last admin
    const targetMembership = project.members.find(m => m.userId === userId)
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      )
    }

    if (targetMembership.role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = project.members.filter(m => m.role === 'ADMIN').length
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove admin role from the last admin" },
          { status: 400 }
        )
      }
    }

    // Update member role
    const updatedMembership = await db.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
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
    console.error("Failed to update project member:", error)
    return NextResponse.json(
      { error: "Failed to update project member" },
      { status: 500 }
    )
  }
}

// Remove member from project
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: projectId, userId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    // Check if requester is admin
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        members: true
      }
    })

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      )
    }

    const requesterMembership = project.members.find(m => m.userId === session.user.id)
    if (!requesterMembership || requesterMembership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: "Only project admins can remove members" },
        { status: 403 }
      )
    }

    // Prevent removing the last admin
    const targetMembership = project.members.find(m => m.userId === userId)
    if (!targetMembership) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      )
    }

    if (targetMembership.role === 'ADMIN') {
      const adminCount = project.members.filter(m => m.role === 'ADMIN').length
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last admin from the project" },
          { status: 400 }
        )
      }
    }

    // Get user info for logging
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true }
    })

    // Remove member
    await db.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId
        }
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId,
        userId: session.user.id,
        action: "MEMBER_REMOVED",
        metadata: { removedUser: user?.name || user?.email }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to remove project member:", error)
    return NextResponse.json(
      { error: "Failed to remove project member" },
      { status: 500 }
    )
  }
}
