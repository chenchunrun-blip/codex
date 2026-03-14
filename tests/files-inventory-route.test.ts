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
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: filesInventoryGet } = require("@/app/api/files/inventory/route")

describe("Files Inventory Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json inventory payload", async () => {
    const now = new Date("2026-03-13T11:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
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
      { fileId: "file_1", taskId: "task_1" },
      { fileId: "file_1", taskId: "task_1" }
    ])

    const req = new Request("http://localhost/api/files/inventory")
    const res = await filesInventoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.files[0].linkedTaskCount).toBe(1)
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date("2026-03-13T11:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
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
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/files/inventory?format=markdown")
    const res = await filesInventoryGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Files Inventory Report")
    expect(text).toContain("| PRD | Alpha | CUSTOM | DRAFT | 0 |")
  })

  it("returns 403 for inaccessible source project", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])

    const req = new Request("http://localhost/api/files/inventory?sourceProjectId=p2")
    const res = await filesInventoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
