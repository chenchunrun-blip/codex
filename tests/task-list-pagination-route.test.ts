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
      count: jest.fn(),
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

describe("Task List Pagination Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns paged task list metadata when page/limit are provided", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.count.mockResolvedValue(3)
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_3",
        title: "Task 3",
        description: null,
        status: "PENDING",
        priority: 1,
        assigneeType: "HUMAN",
        assignmentMode: "MANUAL",
        dueDate: null,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        specMarkdown: null,
        functionalAgentType: null,
        deliverables: [],
        project: { id: "proj_1", name: "Project 1" },
        assignee: null,
        agent: null,
        _count: { deliverables: 0 }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])

    const req = new Request(
      "http://localhost/api/tasks?projectId=proj_1&page=2&limit=2&sortBy=createdAt&sortOrder=desc"
    )
    const res = await listTasksGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(3)
    expect(data.page).toBe(2)
    expect(data.limit).toBe(2)
    expect(data.hasMore).toBe(false)
    expect(data.tasks).toHaveLength(1)
    expect(dbMock.task.count).toHaveBeenCalled()
    expect(dbMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 2,
        take: 2
      })
    )
  })

  it("applies search/priority/assignment filters to pagination query", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.count.mockResolvedValue(0)
    dbMock.task.findMany.mockResolvedValue([])
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])

    const req = new Request(
      "http://localhost/api/tasks?projectId=proj_1&page=1&limit=20&q=alpha&priority=2&assignmentMode=AI_AUTO&assigneeUnassigned=1"
    )
    const res = await listTasksGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(0)
    expect(dbMock.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "proj_1",
          assignmentMode: "AI_AUTO",
          assigneeId: null,
          priority: 2,
          OR: expect.any(Array)
        })
      })
    )
  })
})
