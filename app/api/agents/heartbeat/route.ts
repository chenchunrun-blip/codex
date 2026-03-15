import { requireAgentAuth } from "@/lib/auth/agent-auth"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

const AGENT_ONLINE_WINDOW_MS = 5 * 60 * 1000

/**
 * POST /api/agents/heartbeat
 * Agent heartbeat endpoint (agent-auth required).
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAgentAuth(req)
    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error, code: authResult.code },
        { status: authResult.status }
      )
    }

    const now = new Date()
    const updated = await db.agent.update({
      where: { id: authResult.agent.id },
      data: {
        updatedAt: now
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        updatedAt: true,
        isActive: true
      }
    })

    return NextResponse.json({
      agent: {
        ...updated,
        lastActiveAt: updated.updatedAt,
        isOnline: Date.now() - updated.updatedAt.getTime() <= AGENT_ONLINE_WINDOW_MS
      }
    })
  } catch (error) {
    console.error("Agent heartbeat error:", error)
    return NextResponse.json(
      { error: "Failed to update agent heartbeat", code: "AGENT_HEARTBEAT_FAILED" },
      { status: 500 }
    )
  }
}

