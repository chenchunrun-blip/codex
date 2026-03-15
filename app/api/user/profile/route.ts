import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function PATCH(req: Request) {
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

    const payload = body as {
      name?: unknown
      nickname?: unknown
      emailEnabled?: unknown
    }
    const name = payload.name
    const nickname = payload.nickname
    const emailEnabled = payload.emailEnabled

    if (
      (name !== undefined && typeof name !== "string") ||
      (nickname !== undefined && nickname !== null && typeof nickname !== "string") ||
      (emailEnabled !== undefined && typeof emailEnabled !== "boolean")
    ) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const updatedUser = await db.user.update({
      where: { id: session.user!.id },
      data: {
        ...(name !== undefined && { name }),
        ...(nickname !== undefined && { nickname }),
        ...(emailEnabled !== undefined && { emailEnabled })
      }
    })

    return NextResponse.json(updatedUser)
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json(
      { error: "Failed to update profile", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const session = await requireAuth()

    const user = await db.user.findUnique({
      where: { id: session.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        nickname: true,
        avatar: true,
        emailEnabled: true,
        createdAt: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found", code: "USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error("User fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch user", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
