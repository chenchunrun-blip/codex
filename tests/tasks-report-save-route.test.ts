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
      findMany: jest.fn()
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
const { POST: saveTasksReportPost } = require("@/app/api/tasks/report/save/route")

describe("Tasks Report Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Task A",
        status: "PENDING",
        priority: 2,
        dueDate: null,
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        project: { id: "p1", name: "Alpha" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "tasks-report.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTasksReportPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("AGENT_QUEUE | ENGINEERING")
        })
      })
    )
  })

  it("returns 403 for viewer membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "VIEWER", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])

    const req = new Request("http://localhost/api/tasks/report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTasksReportPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
