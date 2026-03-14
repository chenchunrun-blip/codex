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
    template: {
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
const { POST: saveCatalogPost } = require("@/app/api/templates/catalog/save/route")

describe("Template Catalog Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves catalog for editor project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.template.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Project Charter (PM)",
        category: "PROBLEM_DEFINITION",
        isBuiltIn: true,
        updatedAt: now
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: {
          type: "FILE_CREATED_FROM_TEMPLATE",
          templateId: "t1"
        }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "templates-catalog.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/templates/catalog/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveCatalogPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer-only membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/templates/catalog/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveCatalogPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
