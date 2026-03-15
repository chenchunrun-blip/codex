import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { encrypt } from "@/lib/utils/encryption"
import { NextResponse } from "next/server"
import { TeamRole } from "@prisma/client"

/**
 * POST /api/agents/[id]/regenerate-key - Regenerate agent API key
 * Requires: Team admin role
 *
 * Returns the new API key in the response (only time it's visible)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    // Check if user is a team admin
    const adminMembership = await db.teamMember.findFirst({
      where: {
        userId: session.user!.id,
        role: TeamRole.ADMIN
      }
    })

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Only team admins can regenerate agent keys", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    const agent = await db.agent.findUnique({
      where: { id }
    })

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", code: "AGENT_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Generate a new API key
    const newApiKey = `md_agent_${crypto.randomUUID().replace(/-/g, '')}`

    // Encrypt and store
    const apiKeyEncrypted = encrypt(newApiKey)

    await db.agent.update({
      where: { id },
      data: {
        apiKeyEncrypted
      }
    })

    // Return the new key (only time it's visible)
    return NextResponse.json({
      success: true,
      apiKey: newApiKey,
      message: "API key regenerated. Save this key securely as it won't be shown again."
    })
  } catch (error) {
    console.error("API key regeneration error:", error)
    return NextResponse.json(
      { error: "Failed to regenerate API key", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
