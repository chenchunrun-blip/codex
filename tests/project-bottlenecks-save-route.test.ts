import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    project: {
      findUnique: jest.fn()
    },
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    file: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: savePost } = require("@/app/api/projects/[id]/bottlenecks/save/route")

describe("Project Bottlenecks Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves bottlenecks report as file", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.task.groupBy.mockResolvedValue([])
    dbMock.task.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.file.create.mockResolvedValue({
      id: "file_1",
      name: "project-bottlenecks-xxx.md",
      createdAt: new Date("2026-03-12T10:00:00.000Z")
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks/save", {
      method: "POST"
    })
    const res = await savePost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.file.id).toBe("file_1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("rejects viewer role", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks/save", {
      method: "POST"
    })
    const res = await savePost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
