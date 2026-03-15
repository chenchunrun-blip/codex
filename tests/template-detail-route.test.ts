import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    template: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const {
  GET: templateGet,
  PATCH: templatePatch,
  DELETE: templateDelete
} = require("@/app/api/templates/[id]/route")

describe("Template Detail Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("rejects updating built-in templates", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_1",
      creatorId: "user_1",
      isBuiltIn: true
    })

    const req = new Request("http://localhost/api/templates/tpl_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated",
        description: "desc",
        category: "CUSTOM",
        content: "# content",
        isPublic: true
      })
    })
    const res = await templatePatch(req, { params: Promise.resolve({ id: "tpl_1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("BUILTIN_TEMPLATE_READ_ONLY")
  })

  it("allows creator to delete custom template", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_2",
      creatorId: "user_1",
      isBuiltIn: false
    })
    dbMock.template.delete.mockResolvedValue({})

    const req = new Request("http://localhost/api/templates/tpl_2", { method: "DELETE" })
    const res = await templateDelete(req, { params: Promise.resolve({ id: "tpl_2" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(dbMock.template.delete).toHaveBeenCalled()
  })

  it("returns 403 for private template by non-creator", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_3",
      creatorId: "another_user",
      isPublic: false,
      creator: null
    })

    const req = new Request("http://localhost/api/templates/tpl_3")
    const res = await templateGet(req, { params: Promise.resolve({ id: "tpl_3" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})

