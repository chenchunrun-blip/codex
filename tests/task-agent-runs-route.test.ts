import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_actor", email: "actor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    },
    user: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: taskRunsGet } = require("@/app/api/tasks/[id]/runs/route")

describe("Task Agent Runs Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns normalized agent run history", async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_1",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        id: "log_2",
        userId: "user_actor",
        createdAt: new Date("2026-03-12T10:20:00.000Z"),
        metadata: {
          type: "AGENT_RUN_FAILED",
          executionId: "exec_2",
          error: "timeout"
        }
      },
      {
        id: "log_1",
        userId: "user_actor",
        createdAt: new Date("2026-03-12T10:10:00.000Z"),
        metadata: {
          type: "AGENT_RUN_TRIGGERED",
          executionId: "exec_1",
          targetAgent: "eng-agent",
          runtimeMode: "ENDPOINT",
          deliverableId: "del_1",
          idempotencyKey: "idem_1"
        }
      }
    ])
    dbMock.user.findMany.mockResolvedValue([
      {
        id: "user_actor",
        name: "Actor",
        email: "actor@example.com"
      }
    ])

    const req = new Request("http://localhost/api/tasks/task_1/runs?limit=20")
    const res = await taskRunsGet(req, { params: Promise.resolve({ id: "task_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.taskId).toBe("task_1")
    expect(Array.isArray(data.runs)).toBe(true)
    expect(data.runs).toHaveLength(2)
    expect(data.runs[0]).toMatchObject({
      executionId: "exec_2",
      status: "FAILED",
      error: "timeout",
      triggeredBy: {
        id: "user_actor",
        name: "Actor",
        email: "actor@example.com"
      }
    })
    expect(data.runs[1]).toMatchObject({
      executionId: "exec_1",
      status: "SUCCESS",
      targetAgent: "eng-agent",
      runtimeMode: "ENDPOINT",
      deliverableId: "del_1"
    })
  })

  it("returns 404 when task does not exist", async () => {
    dbMock.task.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/task_missing/runs")
    const res = await taskRunsGet(req, { params: Promise.resolve({ id: "task_missing" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("TASK_NOT_FOUND")
  })

  it("returns 403 when requester is not a project member", async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_1",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/task_1/runs")
    const res = await taskRunsGet(req, { params: Promise.resolve({ id: "task_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
