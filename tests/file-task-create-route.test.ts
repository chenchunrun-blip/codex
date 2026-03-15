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
    agent: {
      findUnique: jest.fn()
    },
    task: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const {
  GET: listTasksFromFileGet,
  POST: createTaskFromFilePost
} = require("@/app/api/files/[id]/tasks/route")

describe("Create Task From File Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates task from markdown file for editor", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      name: "Architecture.md",
      content: "# Architecture\n\n## Goal\n- Build scalable system",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.task.create.mockResolvedValue({
      id: "task_1",
      title: "Task from Architecture",
      projectId: "proj_1"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/files/file_1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Task from Architecture"
      })
    })

    const res = await createTaskFromFilePost(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.task.id).toBe("task_1")
    expect(data.source.fileId).toBe("file_1")
    expect(dbMock.task.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("lists tasks linked to markdown file", async () => {
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
        taskId: "task_2",
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: { type: "TASK_CREATED_FROM_FILE" },
        task: {
          id: "task_2",
          title: "Implement parser",
          status: "PENDING",
          assignmentMode: "MANUAL",
          assigneeType: "HUMAN"
        }
      }
    ])

    const req = new Request("http://localhost/api/files/file_1/tasks")
    const res = await listTasksFromFileGet(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.tasks)).toBe(true)
    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0].task.title).toBe("Implement parser")
  })

  it("returns 403 for viewer role", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      name: "Architecture.md",
      content: "# Architecture",
      projectId: "proj_1"
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/files/file_1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Task from Architecture" })
    })

    const res = await createTaskFromFilePost(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
