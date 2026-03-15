import { describe, expect, it } from "@jest/globals"

jest.mock("@/lib/db", () => ({
  db: {}
}))

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

const { POST: convertPost } = require("@/app/api/convert/route")

describe("Convert Route", () => {
  it("returns invalid payload code when no file is provided", async () => {
    const form = new FormData()
    form.append("format", "markdown")

    const req = new Request("http://localhost/api/convert", {
      method: "POST",
      body: form
    })

    const res = await convertPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })
})
