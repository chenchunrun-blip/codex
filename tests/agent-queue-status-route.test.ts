import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    task: {
      groupBy: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: queueStatusGet } = require("@/app/api/agents/queue-status/route")

describe("Agent Queue Status Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns domain status for project", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } },
      { functionalAgentType: "QA", _count: { _all: 1 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        capabilities: ["engineering"],
        updatedAt: new Date()
      },
      {
        id: "agent_2",
        capabilities: ["qa"],
        updatedAt: new Date(Date.now() - 10 * 60 * 1000)
      }
    ])

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1")
    const res = await queueStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.domains)).toBe(true)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.backlog).toBe(3)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.onlineAgents).toBe(1)
  })

  it("returns 403 when user is not project member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1")
    const res = await queueStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("falls back when FUNCTIONAL_AGENT query is incompatible", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy
      .mockRejectedValueOnce(new Error("Invalid enum FUNCTIONAL_AGENT"))
      .mockResolvedValueOnce([{ functionalAgentType: "ENGINEERING", _count: { _all: 2 } }])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        capabilities: ["engineering"],
        updatedAt: new Date()
      }
    ])

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1")
    const res = await queueStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.backlog).toBe(2)
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        capabilities: ["engineering"],
        updatedAt: new Date()
      }
    ])

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1&format=markdown")
    const res = await queueStatusGet(req)
    const markdown = await res.text()

    expect(res.status).toBe(200)
    expect(markdown).toContain("# Agent Queue Status")
    expect(markdown).toContain("Project ID: proj_1")
    expect(markdown).toContain("ENGINEERING")
  })

  it("returns 200 when active agent query is incompatible", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 1 } }
    ])
    dbMock.agent.findMany.mockRejectedValue(new Error("Unknown table Agent"))

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1")
    const res = await queueStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.backlog).toBe(1)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.activeAgents).toBe(0)
    expect(data.domains.find((d: any) => d.domain === "ENGINEERING")?.onlineAgents).toBe(0)
  })

  it("returns degraded payload when route-level error occurs", async () => {
    dbMock.projectMember.findUnique.mockRejectedValue(new Error("db down"))

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1")
    const res = await queueStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.degraded).toBe(true)
    expect(data.error).toBe("Failed to fetch queue status")
    expect(Array.isArray(data.domains)).toBe(true)
    expect(data.domains.length).toBe(0)
  })

  it("returns degraded markdown when route-level error occurs with markdown format", async () => {
    dbMock.projectMember.findUnique.mockRejectedValue(new Error("db down"))

    const req = new Request("http://localhost/api/agents/queue-status?projectId=proj_1&format=markdown")
    const res = await queueStatusGet(req)
    const markdown = await res.text()

    expect(res.status).toBe(200)
    expect(markdown).toContain("# Agent Queue Status")
    expect(markdown).toContain("Degraded: yes")
    expect(markdown).toContain("Failed to fetch queue status")
  })
})
