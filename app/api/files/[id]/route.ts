import { requireAuth, requireProjectAccess } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { FileStatus } from "@prisma/client"
import { sendFileUpdateEmail } from "@/lib/email/send-notification"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()
    const { content, name } = await req.json()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const file = await db.file.findUnique({
      where: { id }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify project access
    const { membership } = await requireProjectAccess(file.projectId, "EDITOR")

    // Update file
    const updatedFile = await db.file.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(name !== undefined && { name }),
        updatedAt: new Date(),
        lastAutoSave: new Date()
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: file.projectId,
        fileId: file.id,
        userId: session.user.id,
        action: "FILE_UPDATED"
      }
    })

    // Create notifications for other project members
    const projectMembers = await db.projectMember.findMany({
      where: {
        projectId: file.projectId,
        userId: { not: session.user.id } // Don't notify the updater
      },
      include: {
        user: {
          select: { id: true, email: true, name: true }
        }
      }
    })

    // Get project name for email
    const project = await db.project.findUnique({
      where: { id: file.projectId },
      select: { name: true }
    })

    for (const member of projectMembers) {
      await db.notification.create({
        data: {
          userId: member.user.id,
          type: 'FILE_CHANGED',
          title: '📄 File Updated',
          content: `${session.user.name || session.user.email} updated "${name || file.name}"`,
          link: `/editor/${file.id}`
        }
      })

      // Send email notification
      await sendFileUpdateEmail(
        member.user.email,
        session.user.name || session.user.email || 'Someone',
        session.user.email || '',
        name || file.name,
        project?.name || 'Unknown Project',
        file.id
      )
    }

    return NextResponse.json(updatedFile)
  } catch (error) {
    console.error("File update error:", error)
    return NextResponse.json(
      { error: "Failed to update file", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const file = await db.file.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            members: true
          }
        },
        creator: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 10
        }
      }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify access
    const hasAccess = file.project.members.some(m => m.userId === session.user!.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Access denied", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    return NextResponse.json(file)
  } catch (error) {
    console.error("File fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch file", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const file = await db.file.findUnique({
      where: { id }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify project admin access
    await requireProjectAccess(file.projectId, "ADMIN")

    // Delete related records first
    await db.comment.deleteMany({
      where: { fileId: id }
    })

    await db.fileVersion.deleteMany({
      where: { fileId: id }
    })

    await db.activityLog.deleteMany({
      where: { fileId: id }
    })

    // Delete the file
    await db.file.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("File delete error:", error)
    return NextResponse.json(
      { error: "Failed to delete file", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
