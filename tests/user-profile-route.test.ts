import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    user: {
      update: jest.fn(),
      findUnique: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { PATCH: profilePatch, GET: profileGet } = require("@/app/api/user/profile/route")

describe("User Profile Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid payload code for invalid profile patch", async () => {
    const req = new Request("http://localhost/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailEnabled: "yes" })
    })

    const res = await profilePatch(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("returns user not found code", async () => {
    dbMock.user.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/user/profile")
    const res = await profileGet(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("USER_NOT_FOUND")
  })
})
