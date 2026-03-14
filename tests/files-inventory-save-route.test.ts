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
    file: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveInventoryPost } = require("@/app/api/files/inventory/save/route")

describe("Files Inventory Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves inventory report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.file.findMany.mockResolvedValue([
      {
        id: "file_1",
        name: "PRD",
        fileType: "CUSTOM",
        status: "DRAFT",
        updatedAt: now,
        project: { id: "p1", name: "Alpha" }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { fileId: "file_1", taskId: "task_1" }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f_report",
      name: "files-inventory.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/files/inventory/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveInventoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f_report")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer-only membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/files/inventory/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveInventoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
