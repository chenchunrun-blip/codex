import { authorizeLiveblocksAccess } from "@/lib/liveblocks/config"
import { NextResponse } from "next/server"
import { Liveblocks } from "@liveblocks/node"

export async function POST(req: Request) {
  // Check if Liveblocks is configured
  if (!process.env.LIVEBLOCKS_SECRET) {
    return NextResponse.json(
      { error: "Liveblocks is not configured", code: "LIVEBLOCKS_NOT_CONFIGURED" },
      { status: 501 }
    )
  }

  const liveblocks = new Liveblocks({
    secret: process.env.LIVEBLOCKS_SECRET,
  })

  try {
    let requestBody: unknown
    try {
      requestBody = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const room = typeof (requestBody as { room?: unknown })?.room === "string"
      ? (requestBody as { room: string }).room
      : ""

    if (!room) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Authorize user access
    const authResult = await authorizeLiveblocksAccess(room)

    if (!authResult || !authResult.userId) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Generate Liveblocks authorization
    const session = liveblocks.prepareSession(
      authResult.userId,
      {
        userInfo: authResult.userInfo
      }
    )

    // Allow access to the room
    session.allow(room, session.FULL_ACCESS)

    const { status, body: authBody } = await session.authorize()

    return new NextResponse(authBody, { status })
  } catch (error) {
    console.error("Liveblocks auth error:", error)
    return NextResponse.json(
      { error: "Authorization failed", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
