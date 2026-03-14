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
    task: {
      groupBy: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    file: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveQueueStatusPost } = require("@/app/api/agents/queue-status/save/route")

describe("Agent Queue Status Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves queue status report", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      { id: "a1", capabilities: ["engineering"], updatedAt: now }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "agent-queue-status.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/agents/queue-status/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveQueueStatusPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer-only memberships", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/agents/queue-status/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveQueueStatusPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NO_EDITABLE_PROJECT")
  })
})
