import { requireAuth, requireProjectAccess } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { sendProjectUpdateEmail } from "@/lib/email/send-notification"

// Get project details
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    const project = await db.project.findUnique({
      where: { id },
      include: {
        team: true,
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
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

    // Check if user is a member
    const isMember = project.members.some(m => m.userId === session.user.id)
    if (!isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      )
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error("Project fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch project" },
      { status: 500 }
    )
  }
}

// Update project
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()
    const { name, description, status } = await req.json()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    // Verify admin access
    const { membership } = await requireProjectAccess(id, "ADMIN")

    // Update project
    const updatedProject = await db.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status })
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: id,
        userId: session.user.id,
        action: "PROJECT_UPDATED",
        metadata: { projectName: name || description || status }
      }
    })

    // Notify other project members about the update
    const projectMembers = await db.projectMember.findMany({
      where: {
        projectId: id,
        userId: { not: session.user.id } // Don't notify the updater
      },
      include: {
        user: {
          select: { id: true, email: true, name: true }
        }
      }
    })

    // Get project name for email (fallback to updated project name)
    const projectName = name || updatedProject.name

    for (const member of projectMembers) {
      await db.notification.create({
        data: {
          userId: member.user.id,
          type: 'PROJECT_UPDATED',
          title: '⚙️ Project Updated',
          content: `${session.user.name || session.user.email} updated the project${name ? ` to "${name}"` : ''}`,
          link: `/projects/${id}`
        }
      })

      // Send email notification
      await sendProjectUpdateEmail(
        member.user.email,
        session.user.name || session.user.email || 'Someone',
        session.user.email || '',
        projectName,
        id
      )
    }

    return NextResponse.json(updatedProject)
  } catch (error) {
    console.error("Project update error:", error)
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    )
  }
}

// Delete project
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      )
    }

    // Verify admin access
    await requireProjectAccess(id, "ADMIN")

    // Delete the project (cascade will handle related records)
    await db.project.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Project delete error:", error)
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    )
  }
}
