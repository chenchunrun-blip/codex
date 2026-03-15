import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    agent: {
      findUnique: jest.fn()
    },
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    },
    teamMember: {
      findFirst: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: agentDetailGet } = require("@/app/api/agents/[id]/route")

describe("Agent Detail Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns agent detail with diagnostics", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      description: null,
      type: "AI",
      capabilities: ["engineering"],
      apiEndpoint: null,
      modelConfig: null,
      systemPrompt: null,
      isActive: true,
      updatedAt: new Date("2026-03-12T10:00:00.000Z"),
      apiKeyEncrypted: "enc",
      tasks: [],
      _count: { tasks: 2 }
    })
    dbMock.task.groupBy
      .mockResolvedValueOnce([
        { status: "PENDING", _count: { _all: 1 } },
        { status: "IN_PROGRESS", _count: { _all: 1 } }
      ])
      .mockResolvedValueOnce([{ functionalAgentType: "ENGINEERING", _count: { _all: 3 } }])
    dbMock.task.findMany.mockResolvedValue([{ id: "task_1" }, { id: "task_2" }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:05:00.000Z"),
        metadata: { type: "AGENT_RUN_FAILED" }
      },
      {
        createdAt: new Date("2026-03-12T10:03:00.000Z"),
        metadata: { type: "AGENT_RUN_TRIGGERED" }
      }
    ])

    const req = new Request("http://localhost/api/agents/agent_1")
    const res = await agentDetailGet(req, { params: Promise.resolve({ id: "agent_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.id).toBe("agent_1")
    expect(data.diagnostics.taskStatus.pending).toBe(1)
    expect(data.diagnostics.recentRuns.failed).toBe(1)
    expect(data.diagnostics.queuePressure.backlog).toBe(3)
    expect(data.apiKeyEncrypted).toBeUndefined()
  })

  it("returns 404 when agent is missing", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/agents/missing")
    const res = await agentDetailGet(req, { params: Promise.resolve({ id: "missing" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toBe("Agent not found")
    expect(data.code).toBe("AGENT_NOT_FOUND")
  })
})
