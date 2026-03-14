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
const { POST: saveReportsHistoryPost } = require("@/app/api/reports/history/save/route")

describe("Reports History Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves history report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f1", name: "tasks-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f_saved",
      name: "reports-history.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/reports/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveReportsHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f_saved")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "VIEWER", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])

    const req = new Request("http://localhost/api/reports/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveReportsHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })

  it("supports saving with page filter", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f1", name: "tasks-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f_saved_paged",
      name: "reports-history-page2.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/reports/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 2, limit: 20 })
    })
    const res = await saveReportsHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f_saved_paged")
    const fileCreateArgs = dbMock.file.create.mock.calls[0][0]
    expect(typeof fileCreateArgs?.data?.content).toBe("string")
    expect(fileCreateArgs.data.content).toContain("- Page: 2")
  })
})
