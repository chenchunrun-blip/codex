import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    template: {
      create: jest.fn(),
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: templatesGet, POST: templatesPost } = require("@/app/api/templates/route")

describe("Template Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("supports visibility + query filters", async () => {
    dbMock.template.findMany.mockResolvedValue([])

    const req = new Request(
      "http://localhost/api/templates?visibility=mine&q=retro&sort=name_asc"
    )
    const res = await templatesGet(req)

    expect(res.status).toBe(200)
    expect(dbMock.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ creatorId: "user_1" }),
            expect.objectContaining({
              OR: expect.any(Array)
            })
          ])
        }),
        orderBy: [{ name: "asc" }]
      })
    )
  })

  it("defaults to built-in first ordering", async () => {
    dbMock.template.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/templates")
    const res = await templatesGet(req)

    expect(res.status).toBe(200)
    expect(dbMock.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ isBuiltIn: "desc" }, { createdAt: "desc" }]
      })
    )
  })

  it("returns invalid payload code on create validation failure", async () => {
    const req = new Request("http://localhost/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", category: "INVALID" })
    })

    const res = await templatesPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.template.create).not.toHaveBeenCalled()
  })
})
