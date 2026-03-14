import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: commentId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const isResolved = typeof (body as { isResolved?: unknown })?.isResolved === "boolean"
      ? (body as { isResolved: boolean }).isResolved
      : null
    if (isResolved === null) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Check if comment exists and user has access
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        file: {
          include: {
            project: {
              include: {
                members: true
              }
            }
          }
        }
      }
    })

    if (!comment) {
      return NextResponse.json(
        { error: "Comment not found", code: "COMMENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Check if user is a member of the project
    const hasAccess = comment.file.project.members.some(
      m => m.userId === session.user.id
    )

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    // Update comment
    const updatedComment = await db.comment.update({
      where: { id: commentId },
      data: { isResolved }
    })

    return NextResponse.json(updatedComment)
  } catch (error) {
    console.error("Comment update error:", error)
    return NextResponse.json(
      { error: "Failed to update comment", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id: commentId } = await params

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Check if comment exists and user has access
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        file: {
          include: {
            project: {
              include: {
                members: true
              }
            }
          }
        }
      }
    })

    if (!comment) {
      return NextResponse.json(
        { error: "Comment not found", code: "COMMENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Only the comment author or project admin can delete
    const isAuthor = comment.authorId === session.user.id
    const member = comment.file.project.members.find(
      m => m.userId === session.user.id
    )
    const isAdmin = member?.role === 'ADMIN'

    if (!isAuthor && !isAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    // Delete comment
    await db.comment.delete({
      where: { id: commentId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Comment deletion error:", error)
    return NextResponse.json(
      { error: "Failed to delete comment", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
