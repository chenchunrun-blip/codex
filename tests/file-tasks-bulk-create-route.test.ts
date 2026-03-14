import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findMany: jest.fn()
    },
    projectMember: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    task: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: bulkCreatePost } = require("@/app/api/files/tasks/bulk/route")

describe("Bulk Create Tasks From Files Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates tasks and skips linked files", async () => {
    dbMock.file.findMany.mockResolvedValue([
      { id: "file_1", name: "A.md", content: "# A", projectId: "proj_1" },
      { id: "file_2", name: "B.md", content: "# B", projectId: "proj_1" }
    ])
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "proj_1", role: "EDITOR" }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { fileId: "file_2" }
    ])
    dbMock.task.create.mockResolvedValue({
      id: "task_1",
      title: "Task from A"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/files/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileIds: ["file_1", "file_2"],
        skipIfLinkedTaskExists: true
      })
    })
    const res = await bulkCreatePost(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.createdCount).toBe(1)
    expect(data.skippedCount).toBe(1)
    expect(data.skipped[0].reason).toBe("LINKED_TASK_ALREADY_EXISTS")
  })

  it("returns 403 without editable project membership", async () => {
    dbMock.file.findMany.mockResolvedValue([
      { id: "file_1", name: "A.md", content: "# A", projectId: "proj_1" }
    ])
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "proj_1", role: "VIEWER" }
    ])

    const req = new Request("http://localhost/api/files/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileIds: ["file_1"]
      })
    })
    const res = await bulkCreatePost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})

