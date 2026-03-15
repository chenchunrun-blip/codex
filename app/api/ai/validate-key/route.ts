import { requireAuth } from "@/lib/auth/rbac"
import { validateApiKey } from "@/lib/ai/client"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()

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
    const { apiKey, aiEndpoint } = body as { apiKey?: unknown; aiEndpoint?: unknown }

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: "API key is required", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    if (aiEndpoint !== undefined && aiEndpoint !== null && typeof aiEndpoint !== "string") {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Validate the API key by making a test request
    const isValid = await validateApiKey(apiKey, aiEndpoint as string | undefined)

    return NextResponse.json({ valid: isValid })
  } catch (error) {
    console.error("API key validation error:", error)
    return NextResponse.json(
      {
        error: "Failed to validate API key",
        code: "INTERNAL_ERROR",
        valid: false
      },
      { status: 500 }
    )
  }
}
