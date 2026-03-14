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
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: reportsHistoryGet } = require("@/app/api/reports/history/route")

describe("Reports History Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns filtered JSON history", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: { type: "WORKSPACE_REPORT_SAVED" },
        file: { id: "f1", name: "workspace-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      },
      {
        createdAt: now,
        metadata: { type: "IGNORED_TYPE" },
        file: { id: "f2", name: "x.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])

    const req = new Request("http://localhost/api/reports/history?type=WORKSPACE_REPORT_SAVED")
    const res = await reportsHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.history)).toBe(true)
    expect(data.history).toHaveLength(1)
    expect(data.history[0].type).toBe("WORKSPACE_REPORT_SAVED")
    expect(data.hasMore).toBe(false)
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f1", name: "tasks-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])

    const req = new Request("http://localhost/api/reports/history?format=markdown")
    const res = await reportsHistoryGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Reports History")
    expect(text).toContain("TASKS_REPORT_SAVED")
  })

  it("supports pagination with page and limit", async () => {
    const now = Date.now()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date(now),
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f1", name: "tasks-1.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      },
      {
        createdAt: new Date(now - 1000),
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f2", name: "tasks-2.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])

    const req = new Request("http://localhost/api/reports/history?limit=1&page=2")
    const res = await reportsHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.page).toBe(2)
    expect(data.limit).toBe(1)
    expect(data.hasMore).toBe(false)
    expect(data.history).toHaveLength(1)
    expect(data.history[0].fileId).toBe("f2")
  })

  it("returns hasMore=true when next page exists", async () => {
    const now = Date.now()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date(now),
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f1", name: "tasks-1.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      },
      {
        createdAt: new Date(now - 1000),
        metadata: { type: "TASKS_REPORT_SAVED" },
        file: { id: "f2", name: "tasks-2.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])

    const req = new Request("http://localhost/api/reports/history?limit=1&page=1")
    const res = await reportsHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.page).toBe(1)
    expect(data.limit).toBe(1)
    expect(data.hasMore).toBe(true)
    expect(data.history).toHaveLength(1)
    expect(data.history[0].fileId).toBe("f1")
  })

  it("supports deeper pagination within scan window", async () => {
    const now = Date.now()
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    const logs = Array.from({ length: 320 }).map((_, index) => ({
      createdAt: new Date(now - index * 1000),
      metadata: { type: "TASKS_REPORT_SAVED" },
      file: { id: `f${index + 1}`, name: `tasks-${index + 1}.md` },
      project: { id: "p1", name: "Alpha" },
      user: { name: "Owner", email: "owner@example.com" }
    }))
    dbMock.activityLog.findMany.mockResolvedValue(logs)

    const req = new Request("http://localhost/api/reports/history?limit=50&page=6")
    const res = await reportsHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.page).toBe(6)
    expect(data.limit).toBe(50)
    expect(data.history).toHaveLength(50)
    expect(data.history[0].fileId).toBe("f251")
  })
})
