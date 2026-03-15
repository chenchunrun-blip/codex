import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/utils/encryption", () => ({
  decrypt: jest.fn(() => "agent_secret"),
  secureCompare: jest.fn(() => true)
}))

jest.mock("@/lib/db", () => ({
  db: {
    agent: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: heartbeatPost } = require("@/app/api/agents/heartbeat/route")

describe("Agent Heartbeat Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("updates heartbeat for authenticated active agent", async () => {
    const now = new Date("2026-03-12T10:00:00.000Z")
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.agent.update.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      updatedAt: now,
      isActive: true
    })

    const req = new Request("http://localhost/api/agents/heartbeat", {
      method: "POST",
      headers: {
        "x-agent-id": "agent_1",
        Authorization: "Bearer agent_secret"
      }
    })

    const res = await heartbeatPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.agent.id).toBe("agent_1")
    expect(data.agent.lastActiveAt).toBeDefined()
    expect(dbMock.agent.update).toHaveBeenCalled()
  })

  it("rejects invalid agent credentials", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/agents/heartbeat", {
      method: "POST",
      headers: {
        "x-agent-id": "agent_1",
        Authorization: "Bearer bad_secret"
      }
    })

    const res = await heartbeatPost(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.code).toBe("AGENT_AUTH_INVALID")
  })
})

