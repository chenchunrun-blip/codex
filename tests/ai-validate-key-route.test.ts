import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/ai/client", () => ({
  validateApiKey: jest.fn(async () => true)
}))

const { POST: validateKeyPost } = require("@/app/api/ai/validate-key/route")

describe("AI Validate Key Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid payload code when apiKey is missing", async () => {
    const req = new Request("http://localhost/api/ai/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "" })
    })

    const res = await validateKeyPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })
})
