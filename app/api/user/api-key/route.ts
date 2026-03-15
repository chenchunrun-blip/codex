import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { encrypt } from "@/lib/utils/encryption"
import { NextResponse } from "next/server"

/**
 * POST /api/user/api-key - Save user's AI API configuration
 * Stores the API key encrypted in the database
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
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
    const { apiKey, aiModel, aiEndpoint } = body as {
      apiKey?: unknown
      aiModel?: unknown
      aiEndpoint?: unknown
    }

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { error: "API key is required", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Validate API key format (basic check)
    if (apiKey.length < 10 || apiKey.length > 500) {
      return NextResponse.json(
        { error: "Invalid API key format", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    if (
      (aiModel !== undefined && typeof aiModel !== "string") ||
      (aiEndpoint !== undefined && aiEndpoint !== null && typeof aiEndpoint !== "string")
    ) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Encrypt and store using Prisma's type-safe methods
    const encryptedKey = encrypt(apiKey)

    await db.user.update({
      where: { id: session.user.id },
      data: {
        openaiApiKey: encryptedKey,
        aiModel: (aiModel as string | undefined) || 'gpt-3.5-turbo',
        aiApiEndpoint: (aiEndpoint as string | null | undefined) || null
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("API key save error:", error)
    // Don't expose error details in production
    return NextResponse.json(
      { error: "Failed to save API configuration", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/user/api-key - Get user's AI API configuration status
 * Returns whether user has an API key configured (not the key itself)
 */
export async function GET() {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        openaiApiKey: true,
        aiModel: true,
        aiApiEndpoint: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found", code: "USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      hasApiKey: !!user.openaiApiKey,
      aiModel: user.aiModel,
      aiEndpoint: user.aiApiEndpoint
    })
  } catch (error) {
    console.error("API key fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch API key status", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/user/api-key - Delete user's AI API key
 */
export async function DELETE() {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    await db.user.update({
      where: { id: session.user.id },
      data: {
        openaiApiKey: null,
        aiModel: 'gpt-3.5-turbo',
        aiApiEndpoint: null
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("API key delete error:", error)
    return NextResponse.json(
      { error: "Failed to delete API key", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
