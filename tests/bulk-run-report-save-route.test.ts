import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findFirst: jest.fn()
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
const { POST: saveBulkRunReportPost } = require("@/app/api/projects/bulk-run-report/save/route")

describe("Bulk Run Report Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves scheduler bulk-run report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findFirst.mockResolvedValue({
      projectId: "p1",
      role: "EDITOR",
      project: { id: "p1", name: "Alpha" }
    })
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "bulk-scheduler.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/bulk-run-report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "p1",
        reportType: "PROJECT_BULK_SCHEDULER_REPORT_SAVED",
        content: "# report"
      })
    })
    const res = await saveBulkRunReportPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer role", async () => {
    dbMock.projectMember.findFirst.mockResolvedValue({
      projectId: "p1",
      role: "VIEWER",
      project: { id: "p1", name: "Alpha" }
    })

    const req = new Request("http://localhost/api/projects/bulk-run-report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "p1",
        reportType: "PROJECT_BULK_STARTER_PACK_REPORT_SAVED",
        content: "# report"
      })
    })
    const res = await saveBulkRunReportPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})

