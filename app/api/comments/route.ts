import { requireAuth, requireProjectAccess } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { commentCreateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { sendMentionEmail } from "@/lib/email/send-notification"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const parsed = commentCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Verify file access
    const file = await db.file.findUnique({
      where: { id: validated.fileId },
      include: {
        project: true
      }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    await requireProjectAccess(file.projectId, "EDITOR")

    // Extract @mentions from content
    const mentionRegex = /@(\w+(?:\s+\w+)*)/g
    const mentionedNames = []
    let match

    while ((match = mentionRegex.exec(validated.content)) !== null) {
      mentionedNames.push(match[1])
    }

    // Find mentioned users
    const mentionedUsers = await db.user.findMany({
      where: {
        OR: mentionedNames.map(name => ({
          OR: [
            { name: { contains: name, mode: 'insensitive' } },
            { email: { equals: name } }
          ]
        })),
        projectMemberships: {
          some: {
            projectId: file.projectId
          }
        }
      },
      select: {
        id: true,
        name: true,
        email: true
      }
    })

    // If parentId is provided, verify parent comment exists
    if (validated.parentId) {
      const parentComment = await db.comment.findUnique({
        where: { id: validated.parentId }
      })

      if (!parentComment) {
        return NextResponse.json(
          { error: "Parent comment not found", code: "PARENT_COMMENT_NOT_FOUND" },
          { status: 404 }
        )
      }
    }

    // Create comment with mentions
    const comment = await db.comment.create({
      data: {
        ...validated,
        authorId: session.user.id,
        mentions: {
          create: mentionedUsers.map(user => ({
            userId: user.id
          }))
        }
      },
      include: {
        author: true,
        mentions: {
          include: { user: true }
        }
      }
    })

    // Create notifications for mentioned users
    for (const mentionedUser of mentionedUsers) {
      // Don't notify if user mentioned themselves
      if (mentionedUser.id === session.user.id) continue

      await db.notification.create({
        data: {
          userId: mentionedUser.id,
          type: 'MENTION',
          title: '💬 New Mention',
          content: `${session.user.name || session.user.email} mentioned you in a comment`,
          link: `/editor/${validated.fileId}`
        }
      })

      // Send email notification
      await sendMentionEmail(
        mentionedUser.email,
        session.user.name || session.user.email || 'Someone',
        session.user.email || '',
        file.name,
        file.project.name,
        validated.content,
        file.id
      )
    }

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: file.projectId,
        fileId: validated.fileId,
        userId: session.user.id,
        action: "COMMENT_ADDED"
      }
    })

    return NextResponse.json(comment)
  } catch (error) {
    console.error("Comment creation error:", error)
    return NextResponse.json(
      { error: "Failed to create comment", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const file = await db.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    await requireProjectAccess(file.projectId, "VIEWER")

    const comments = await db.comment.findMany({
      where: { fileId },
      include: {
        author: true,
        mentions: {
          include: { user: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(comments)
  } catch (error) {
    console.error("Comments fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch comments", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
