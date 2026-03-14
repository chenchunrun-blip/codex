import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Count unread notifications
    const unreadCount = await db.notification.count({
      where: {
        userId: session.user.id,
        isRead: false
      }
    })

    return NextResponse.json({ count: unreadCount })
  } catch (error) {
    console.error("Failed to fetch unread count:", error)
    return NextResponse.json(
      { error: "Failed to fetch unread count", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
