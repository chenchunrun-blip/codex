import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    },
    notification: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { PATCH: patchTaskStatus } = require("@/app/api/tasks/[id]/status/route")

describe("Task Status Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/tasks/task_1/status", {
      method: "PATCH",
      body: "{invalid"
    })

    const res = await patchTaskStatus(req, { params: Promise.resolve({ id: "task_1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("returns 400 for invalid request payload", async () => {
    const req = new Request("http://localhost/api/tasks/task_1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })

    const res = await patchTaskStatus(req, { params: Promise.resolve({ id: "task_1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })

  it("returns 403 when user is not a project member", async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_1",
      projectId: "proj_1",
      title: "Task 1",
      assigneeId: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/task_1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" })
    })

    const res = await patchTaskStatus(req, { params: Promise.resolve({ id: "task_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
