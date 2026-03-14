export const AGENT_ONLINE_WINDOW_MS = 5 * 60 * 1000

export type AgentSelectionCandidate = {
  id: string
  capabilities: unknown
  updatedAt?: Date | string | null
}

function normalizeCapabilities(capabilities: unknown): string[] {
  if (!Array.isArray(capabilities)) return []
  return capabilities
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean)
}

export function isAgentOnline(updatedAt?: Date | string | null): boolean {
  if (!updatedAt) return false
  const ts = new Date(updatedAt).getTime()
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts <= AGENT_ONLINE_WINDOW_MS
}

export function pickPreferredAgent(
  agents: AgentSelectionCandidate[],
  domainType?: string | null
): { agentId: string | null; online: boolean } {
  if (agents.length === 0) {
    return { agentId: null, online: false }
  }

  const domain = (domainType || "").trim().toLowerCase()
  const matched = domain
    ? agents.filter((agent) => normalizeCapabilities(agent.capabilities).includes(domain))
    : []
  const pool = matched.length > 0 ? matched : agents
  const onlineFirst = pool.find((agent) => isAgentOnline(agent.updatedAt))
  if (onlineFirst) {
    return { agentId: onlineFirst.id, online: true }
  }
  return { agentId: pool[0]?.id || null, online: false }
}

