import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/utils/encryption", () => ({
  encrypt: jest.fn((value: string) => `enc:${value}`)
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
const { POST: apiKeyPost, GET: apiKeyGet } = require("@/app/api/user/api-key/route")

describe("User API Key Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid payload code for missing api key", async () => {
    const req = new Request("http://localhost/api/user/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "" })
    })

    const res = await apiKeyPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.user.update).not.toHaveBeenCalled()
  })

  it("returns user not found code for status request", async () => {
    dbMock.user.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/user/api-key")
    const res = await apiKeyGet(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("USER_NOT_FOUND")
  })
})
