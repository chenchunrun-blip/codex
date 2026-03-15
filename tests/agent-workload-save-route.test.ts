import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findMany: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    task: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    file: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveAgentWorkloadPost } = require("@/app/api/agents/workload/save/route")

describe("Save Agent Workload Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves workload report to default editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      { id: "a1", name: "agent-1", displayName: "Agent 1", isActive: true, updatedAt: now }
    ])
    dbMock.task.findMany.mockResolvedValue([
      { id: "t1", agentId: "a1", status: "IN_PROGRESS" }
    ])
    dbMock.task.count.mockResolvedValue(3)
    dbMock.activityLog.findMany.mockResolvedValue([
      { taskId: "t1", createdAt: now, metadata: { type: "AGENT_RUN_TRIGGERED" } }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "agent-workload-report.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/agents/workload/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveAgentWorkloadPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/agents/workload/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveAgentWorkloadPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
