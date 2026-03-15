import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  })),
  requireProjectAccess: jest.fn(async () => ({
    membership: { role: "EDITOR" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    project: {
      findUnique: jest.fn()
    },
    template: {
      findUnique: jest.fn()
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
const { POST: filesPost } = require("@/app/api/files/route")

describe("Files Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.file.create.mockResolvedValue({
      id: "file_1",
      name: "PRD",
      projectId: "proj_1"
    })
    dbMock.activityLog.create.mockResolvedValue({})
  })

  it("creates file from accessible template", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_1",
      category: "PROBLEM_DEFINITION",
      content: "# Template",
      isBuiltIn: true,
      isPublic: true,
      creatorId: "user_2"
    })

    const req = new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        templateId: "tpl_1"
      })
    })
    const res = await filesPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.id).toBe("file_1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 404 for missing template", async () => {
    dbMock.template.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        templateId: "tpl_missing"
      })
    })
    const res = await filesPost(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("TEMPLATE_NOT_FOUND")
    expect(dbMock.file.create).not.toHaveBeenCalled()
  })

  it("returns 403 for private template by another user", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_private",
      category: "CUSTOM",
      content: "# Private",
      isBuiltIn: false,
      isPublic: false,
      creatorId: "another_user"
    })

    const req = new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        templateId: "tpl_private"
      })
    })
    const res = await filesPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
    expect(dbMock.file.create).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid payload", async () => {
    const req = new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "",
        name: ""
      })
    })
    const res = await filesPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.file.create).not.toHaveBeenCalled()
  })
})
