import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function POST(
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

    const notification = await db.notification.findUnique({
      where: { id }
    })

    if (!notification) {
      return NextResponse.json(
        { error: "Notification not found", code: "NOTIFICATION_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (notification.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const updated = await db.notification.update({
      where: { id },
      data: {
        isRead: true
      }
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Mark notification error:", error)
    return NextResponse.json(
      { error: "Failed to mark notification as read", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
