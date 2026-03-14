import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    team: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: teamsGet } = require("@/app/api/teams/route")

describe("Team Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("supports search + name sort", async () => {
    dbMock.team.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/teams?q=platform&sort=name_asc")
    const res = await teamsGet(req)

    expect(res.status).toBe(200)
    expect(dbMock.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
          members: expect.any(Object)
        }),
        orderBy: { name: "asc" }
      })
    )
  })

  it("supports members_desc in-memory sort", async () => {
    dbMock.team.findMany.mockResolvedValue([
      { id: "t1", name: "A", members: [{ id: "m1" }], _count: { projects: 1 } },
      { id: "t2", name: "B", members: [{ id: "m1" }, { id: "m2" }], _count: { projects: 2 } }
    ])

    const req = new Request("http://localhost/api/teams?sort=members_desc")
    const res = await teamsGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data[0].id).toBe("t2")
  })
})

