import { describe, expect, it } from "@jest/globals"
import { isAgentOnline, pickPreferredAgent } from "@/lib/tasks/agent-selection"

describe("Agent Selection", () => {
  it("marks agent online within heartbeat window", () => {
    const now = Date.now()
    expect(isAgentOnline(new Date(now - 60 * 1000))).toBe(true)
    expect(isAgentOnline(new Date(now - 10 * 60 * 1000))).toBe(false)
  })

  it("prefers online domain-matched agent", () => {
    const now = new Date()
    const old = new Date(Date.now() - 10 * 60 * 1000)
    const result = pickPreferredAgent(
      [
        { id: "agent_offline", capabilities: ["engineering"], updatedAt: old },
        { id: "agent_online", capabilities: ["engineering"], updatedAt: now }
      ],
      "ENGINEERING"
    )
    expect(result.agentId).toBe("agent_online")
    expect(result.online).toBe(true)
  })

  it("falls back to any online agent when no domain match", () => {
    const now = new Date()
    const result = pickPreferredAgent(
      [
        { id: "agent_online_qa", capabilities: ["qa"], updatedAt: now },
        { id: "agent_offline_ops", capabilities: ["operations"], updatedAt: null }
      ],
      "DESIGN"
    )
    expect(result.agentId).toBe("agent_online_qa")
    expect(result.online).toBe(true)
  })
})

