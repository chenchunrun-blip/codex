import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    template: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: templateCatalogGet } = require("@/app/api/templates/catalog/route")

describe("Template Catalog Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json catalog payload", async () => {
    const now = new Date("2026-03-13T10:00:00.000Z")
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

    const req = new Request("http://localhost/api/templates/catalog")
    const res = await templateCatalogGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.templates[0].usageCount).toBe(1)
    expect(data.templates[0].name).toBe("Project Charter (PM)")
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date("2026-03-13T10:00:00.000Z")
    dbMock.template.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Project Charter (PM)",
        category: "PROBLEM_DEFINITION",
        isBuiltIn: true,
        updatedAt: now
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/templates/catalog?format=markdown")
    const res = await templateCatalogGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Templates Catalog Report")
    expect(text).toContain("Project Charter (PM)")
  })
})
