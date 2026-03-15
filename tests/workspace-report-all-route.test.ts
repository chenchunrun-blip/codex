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
    team: {
      count: jest.fn()
    },
    project: {
      findMany: jest.fn()
    },
    file: {
      count: jest.fn()
    },
    task: {
      groupBy: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: workspaceReportGet } = require("@/app/api/workspace/report/route")

describe("Workspace Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json workspace report payload", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }, { projectId: "p2" }])
    dbMock.team.count.mockResolvedValue(2)
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha", updatedAt: now, team: { name: "Team A" } }
    ])
    dbMock.file.count.mockResolvedValue(8)
    dbMock.task.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { _all: 3 } },
      { status: "IN_PROGRESS", _count: { _all: 2 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      { id: "a1", updatedAt: now },
      { id: "a2", updatedAt: new Date(now.getTime() - 30 * 60 * 1000) }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        projectId: "p1",
        metadata: { type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED", successCount: 2, failedCount: 1 }
      }
    ])

    const req = new Request("http://localhost/api/workspace/report")
    const res = await workspaceReportGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary).toMatchObject({
      teams: 2,
      projects: 2,
      files: 8,
      activeAgents: 2,
      onlineAgents: 1
    })
    expect(Array.isArray(data.taskStatus)).toBe(true)
    expect(typeof data.markdown).toBe("string")
    expect(data.markdown).toContain("# Workspace Report")
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.team.count.mockResolvedValue(1)
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha", updatedAt: now, team: { name: "Team A" } }
    ])
    dbMock.file.count.mockResolvedValue(1)
    dbMock.task.groupBy.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/workspace/report?format=markdown")
    const res = await workspaceReportGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Workspace Report")
  })
})
