import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "admin_1", email: "admin@example.com", name: "Admin" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    team: {
      findUnique: jest.fn()
    },
    user: {
      findMany: jest.fn()
    },
    teamMember: {
      createMany: jest.fn()
    },
    notification: {
      createMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: bulkAddPost } = require("@/app/api/teams/[id]/members/bulk-add/route")

describe("Team Members Bulk Add Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("adds members in bulk and reports not-found/already-member emails", async () => {
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      members: [
        { userId: "admin_1", role: "ADMIN" },
        { userId: "user_existing", role: "MEMBER" }
      ]
    })
    dbMock.user.findMany.mockResolvedValue([
      { id: "user_existing", email: "existing@example.com" },
      { id: "user_new", email: "new@example.com" }
    ])
    dbMock.teamMember.createMany.mockResolvedValue({ count: 1 })
    dbMock.notification.createMany.mockResolvedValue({ count: 1 })

    const req = new Request("http://localhost/api/teams/team_1/members/bulk-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails: ["existing@example.com", "new@example.com", "none@example.com"],
        role: "MEMBER"
      })
    })
    const res = await bulkAddPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.addedCount).toBe(1)
    expect(data.alreadyMemberCount).toBe(1)
    expect(data.notFoundCount).toBe(1)
    expect(dbMock.teamMember.createMany).toHaveBeenCalled()
  })

  it("rejects non-admin callers", async () => {
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      members: [{ userId: "admin_1", role: "MEMBER" }]
    })

    const req = new Request("http://localhost/api/teams/team_1/members/bulk-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails: ["a@example.com"]
      })
    })
    const res = await bulkAddPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("TEAM_ADMIN_REQUIRED")
  })
})
