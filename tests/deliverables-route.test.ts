import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    deliverable: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    notification: {
      create: jest.fn()
    },
    file: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: deliverablesPost, GET: deliverablesGet } = require("@/app/api/deliverables/route")

describe("Deliverables Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates submitted deliverable", async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_1",
      title: "Task One",
      projectId: "proj_1",
      project: { id: "proj_1", name: "Alpha" }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "EDITOR"
    })
    dbMock.deliverable.create.mockResolvedValue({
      id: "del_1",
      taskId: "task_1",
      status: "SUBMITTED",
      name: "Implementation Summary",
      task: { id: "task_1", title: "Task One", projectId: "proj_1", project: { name: "Alpha" } },
      file: null
    })
    dbMock.projectMember.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/deliverables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "task_1",
        name: "Implementation Summary",
        type: "markdown",
        content: "# Done",
        createFile: false
      })
    })
    const res = await deliverablesPost(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.id).toBe("del_1")
    expect(dbMock.deliverable.create).toHaveBeenCalled()
  })

  it("rejects GET when user is not a project member", async () => {
    dbMock.task.findUnique.mockResolvedValue({
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/deliverables?taskId=task_1")
    const res = await deliverablesGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.error).toBe("Not a project member")
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("rejects POST with invalid payload", async () => {
    const req = new Request("http://localhost/api/deliverables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "",
        name: "",
        type: "",
        content: ""
      })
    })
    const res = await deliverablesPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.deliverable.create).not.toHaveBeenCalled()
  })
})
