import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    file: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    },
    task: {
      findMany: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: listTasksGet } = require("@/app/api/tasks/route")

describe("Task List Source File Filter Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("lists tasks by sourceFileId", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      { taskId: "task_1" },
      { taskId: "task_2" },
      { taskId: "task_1" }
    ])
    dbMock.task.findMany.mockResolvedValue([
      { id: "task_1", title: "Task 1", status: "PENDING", assigneeType: "HUMAN", specMarkdown: null, dueDate: null },
      { id: "task_2", title: "Task 2", status: "PENDING", assigneeType: "HUMAN", specMarkdown: null, dueDate: null }
    ])
    dbMock.agent.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/tasks?sourceFileId=file_1")
    const res = await listTasksGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(2)
    expect(typeof data.tasks[0].riskScore).toBe("number")
    expect(dbMock.task.findMany).toHaveBeenCalled()
  })

  it("returns 404 when source file is missing", async () => {
    dbMock.file.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks?sourceFileId=file_missing")
    const res = await listTasksGet(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("SOURCE_FILE_NOT_FOUND")
  })
})
