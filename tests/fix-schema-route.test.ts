import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    teamMember: {
      findFirst: jest.fn()
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn()
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: fixSchemaGet } = require("@/app/api/fix-schema/route")

describe("Fix Schema Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns team admin required code for non-admin user", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue(null)

    const req = new Request("http://localhost/api/fix-schema")
    const res = await fixSchemaGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("TEAM_ADMIN_REQUIRED")
  })
})
