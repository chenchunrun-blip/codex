import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    teamMember: {
      findMany: jest.fn()
    },
    user: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: usersGet } = require("@/app/api/users/route")

describe("Users Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns users in project scope when projectId is provided", async () => {
    dbMock.user.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/users?projectId=proj_1")
    const res = await usersGet(req)

    expect(res.status).toBe(200)
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectMemberships: expect.any(Object)
        })
      })
    )
  })
})
