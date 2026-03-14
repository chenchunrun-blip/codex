import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findUnique: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: fileTasksReportGet } = require("@/app/api/files/[id]/tasks-report/route")

describe("File Tasks Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json report payload", async () => {
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

    const req = new Request("http://localhost/api/files/file_1/tasks-report")
    const res = await fileTasksReportGet(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(typeof data.markdown).toBe("string")
    expect(data.markdown).toContain("Linked Tasks Report - Architecture.md")
    expect(data.markdown).toContain("assigneeType=AGENT_QUEUE")
  })

  it("returns text markdown when format=markdown", async () => {
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
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/files/file_1/tasks-report?format=markdown")
    const res = await fileTasksReportGet(req, { params: Promise.resolve({ id: "file_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Linked Tasks Report - Architecture.md")
  })
})
