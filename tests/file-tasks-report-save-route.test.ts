import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findUnique: jest.fn(),
      create: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: fileTasksReportSavePost } = require("@/app/api/files/[id]/tasks-report/save/route")

describe("File Tasks Report Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves linked tasks report as file for editor", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      name: "Architecture.md",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        taskId: "task_1",
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        task: {
          id: "task_1",
          title: "Implement API",
          status: "IN_PROGRESS",
          assignmentMode: "AI_AUTO",
          assigneeType: "FUNCTIONAL_AGENT"
        }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "file_report_1",
      name: "architecture-linked-tasks-report.md",
      createdAt: new Date("2026-03-12T10:01:00.000Z")
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/files/file_1/tasks-report/save", {
      method: "POST"
    })
    const res = await fileTasksReportSavePost(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.file.id).toBe("file_report_1")
    expect(dbMock.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("assigneeType=AGENT_QUEUE")
        })
      })
    )
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("rejects viewer role", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      name: "Architecture.md",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/files/file_1/tasks-report/save", {
      method: "POST"
    })
    const res = await fileTasksReportSavePost(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
