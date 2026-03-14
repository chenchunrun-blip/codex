import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { agentCreateSchema } from "@/lib/utils/validation"
import { encrypt } from "@/lib/utils/encryption"
import { NextResponse } from "next/server"
import { TeamRole } from "@prisma/client"

const AGENT_ONLINE_WINDOW_MS = 5 * 60 * 1000

/**
 * GET /api/agents - Get agent list
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", agents: [] },
        { status: 401 }
      )
    }

    const agents = await db.agent.findMany({
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        type: true,
        capabilities: true,
        apiEndpoint: true,
        modelConfig: true,
        systemPrompt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            tasks: true
          }
        }
      },
      orderBy: [
        { isActive: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    const now = Date.now()
    const normalizedAgents = agents.map((agent) => {
      const lastActiveAt = agent.updatedAt
      const isOnline =
        Boolean(lastActiveAt) && now - new Date(lastActiveAt).getTime() <= AGENT_ONLINE_WINDOW_MS
      return {
        ...agent,
        lastActiveAt,
        isOnline
      }
    })

    return NextResponse.json({ agents: normalizedAgents })
  } catch (error) {
    console.error("Agents fetch error:", error)
    // Check if it's an auth error
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED", agents: [] },
        { status: 401 }
      )
    }
    return NextResponse.json(
      { error: "Failed to fetch agents", code: "INTERNAL_ERROR", agents: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/agents - Create new agent
 * Requires: Admin role (team admin)
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
    const body = await req.json().catch(() => ({}))
    const parsed = agentCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    // Check if user is a team admin (at least one team)
    const adminMembership = await db.teamMember.findFirst({
      where: {
        userId: session.user!.id,
        role: TeamRole.ADMIN
      }
    })

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Only team admins can create agents", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Check if agent name already exists
    const existingAgent = await db.agent.findUnique({
      where: { name: validated.name }
    })

    if (existingAgent) {
      return NextResponse.json(
        { error: "Agent with this name already exists", code: "AGENT_NAME_CONFLICT" },
        { status: 400 }
      )
    }

    // Encrypt API key if provided
    let apiKeyEncrypted: string | undefined
    if (body.apiKey) {
      apiKeyEncrypted = encrypt(body.apiKey)
    }

    const agent = await db.agent.create({
      data: {
        name: validated.name,
        displayName: validated.displayName,
        description: validated.description,
        type: validated.type,
        capabilities: validated.capabilities || [],
        apiEndpoint: validated.apiEndpoint,
        apiKeyEncrypted,
        modelConfig: validated.modelConfig || {},
        systemPrompt: validated.systemPrompt
      }
    })

    return NextResponse.json(agent, { status: 201 })
  } catch (error) {
    console.error("Agent creation error:", error)
    return NextResponse.json(
      { error: "Failed to create agent", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
