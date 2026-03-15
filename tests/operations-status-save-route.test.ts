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
const { POST: saveOperationsStatusPost } = require("@/app/api/operations/status/save/route")

describe("Save Operations Status Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves operations status report to target project", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "ADMIN",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 4 } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.file.create.mockResolvedValue({
      id: "file_1",
      name: "operations-status.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({ id: "log_1" })

    const req = new Request("http://localhost/api/operations/status/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "p1",
        fileName: "operations-status.md"
      })
    })
    const res = await saveOperationsStatusPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("file_1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 when target project permission is viewer", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/operations/status/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "p1" })
    })
    const res = await saveOperationsStatusPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
