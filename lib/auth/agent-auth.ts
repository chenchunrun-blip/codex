import { db } from "@/lib/db"
import { decrypt, secureCompare } from "@/lib/utils/encryption"

type AgentAuthResult =
  | { ok: true; agent: { id: string; name: string; displayName: string; isActive: boolean } }
  | { ok: false; status: number; code: string; error: string }

function readAgentCredentials(req: Request): { agentId: string | null; apiKey: string | null } {
  const agentId = req.headers.get("x-agent-id")?.trim() || null
  const rawAuthorization = req.headers.get("authorization")?.trim() || ""
  const bearerKey = rawAuthorization.toLowerCase().startsWith("bearer ")
    ? rawAuthorization.slice(7).trim()
    : null
  const headerKey = req.headers.get("x-agent-key")?.trim() || null
  const apiKey = bearerKey || headerKey

  return { agentId, apiKey }
}

/**
 * Authenticate autonomous agent requests via x-agent-id + (Authorization: Bearer <key> | x-agent-key)
 */
export async function requireAgentAuth(req: Request): Promise<AgentAuthResult> {
  const { agentId, apiKey } = readAgentCredentials(req)
  if (!agentId || !apiKey) {
    return {
      ok: false,
      status: 401,
      code: "AGENT_AUTH_REQUIRED",
      error: "Agent authentication required"
    }
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      displayName: true,
      isActive: true,
      apiKeyEncrypted: true
    }
  })

  if (!agent || !agent.apiKeyEncrypted) {
    return {
      ok: false,
      status: 401,
      code: "AGENT_AUTH_INVALID",
      error: "Invalid agent credentials"
    }
  }

  if (!agent.isActive) {
    return {
      ok: false,
      status: 403,
      code: "AGENT_INACTIVE",
      error: "Agent is inactive"
    }
  }

  let decryptedKey = ""
  try {
    decryptedKey = decrypt(agent.apiKeyEncrypted)
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AGENT_AUTH_INVALID",
      error: "Invalid agent credentials"
    }
  }

  if (!decryptedKey || !secureCompare(decryptedKey, apiKey)) {
    return {
      ok: false,
      status: 401,
      code: "AGENT_AUTH_INVALID",
      error: "Invalid agent credentials"
    }
  }

  return {
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      isActive: agent.isActive
    }
  }
}
