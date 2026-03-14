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
      count: jest.fn(),
      create: jest.fn()
    },
    task: {
      groupBy: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveWorkspaceReportPost } = require("@/app/api/workspace/report/save/route")

describe("Save Workspace Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves report to default editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])
    dbMock.team.count.mockResolvedValue(1)
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha", updatedAt: now, team: { name: "Team A" } }
    ])
    dbMock.file.count.mockResolvedValue(5)
    dbMock.task.groupBy.mockResolvedValue([{ status: "PENDING", _count: { _all: 2 } }])
    dbMock.agent.findMany.mockResolvedValue([{ id: "a1", updatedAt: now }])
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "workspace-report.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/workspace/report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveWorkspaceReportPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 403 when target project is viewer-only", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "VIEWER", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])

    const req = new Request("http://localhost/api/workspace/report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "p1" })
    })
    const res = await saveWorkspaceReportPost(req)
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
