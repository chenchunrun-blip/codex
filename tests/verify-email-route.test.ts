import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/db", () => ({
  db: {
    verificationToken: {
      findUnique: jest.fn(),
      delete: jest.fn()
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: verifyEmailGet } = require("@/app/api/auth/verify-email/route")

describe("Verify Email Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid query code when token is missing", async () => {
    const req = new Request("http://localhost/api/auth/verify-email")
    const res = await verifyEmailGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
  })

  it("returns invalid token code when token does not exist", async () => {
    dbMock.verificationToken.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/auth/verify-email?token=missing")
    const res = await verifyEmailGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_VERIFICATION_TOKEN")
  })
})
