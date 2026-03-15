import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "admin_1", email: "admin@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    team: {
      findUnique: jest.fn()
    },
    teamMember: {
      updateMany: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: bulkPost } = require("@/app/api/teams/[id]/members/bulk/route")

describe("Team Members Bulk Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("bulk sets roles for selected users", async () => {
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      members: [
        { userId: "admin_1", role: "ADMIN" },
        { userId: "user_2", role: "MEMBER" }
      ]
    })
    dbMock.teamMember.updateMany.mockResolvedValue({ count: 1 })

    const req = new Request("http://localhost/api/teams/team_1/members/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "SET_ROLE",
        role: "ADMIN",
        userIds: ["user_2"]
      })
    })
    const res = await bulkPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.action).toBe("SET_ROLE")
    expect(data.total).toBe(1)
    expect(dbMock.teamMember.updateMany).toHaveBeenCalled()
  })

  it("rejects removing all admins", async () => {
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      members: [
        { userId: "admin_1", role: "ADMIN" }
      ]
    })

    const req = new Request("http://localhost/api/teams/team_1/members/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "REMOVE",
        userIds: ["admin_1"]
      })
    })
    const res = await bulkPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain("admins")
    expect(data.code).toBe("TEAM_LAST_ADMIN_CONSTRAINT")
    expect(dbMock.teamMember.deleteMany).not.toHaveBeenCalled()
  })
})
