import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    team: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: teamsOverviewGet } = require("@/app/api/teams/overview/route")

describe("Teams Overview Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json with starterRuns7d", async () => {
    const now = new Date("2026-03-12T10:00:00.000Z")
    dbMock.team.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Team A",
        description: "desc",
        createdAt: now,
        projects: [{ id: "p1" }],
        _count: { members: 3, projects: 1 }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { projectId: "p1", metadata: { type: "TEAM_STARTER_PACK_APPLIED" } },
      { projectId: "p1", metadata: { type: "PROJECT_TEMPLATE_ROLLOUT" } }
    ])

    const req = new Request("http://localhost/api/teams/overview")
    const res = await teamsOverviewGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.teams[0].starterRuns7d).toBe(2)
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date("2026-03-12T10:00:00.000Z")
    dbMock.team.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Team A",
        description: "desc",
        createdAt: now,
        projects: [{ id: "p1" }],
        _count: { members: 3, projects: 1 }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { projectId: "p1", metadata: { type: "TEAM_STARTER_PACK_APPLIED" } }
    ])

    const req = new Request("http://localhost/api/teams/overview?format=markdown")
    const res = await teamsOverviewGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("Starter Rollouts (7d)")
    expect(text).toContain("| Team A | desc | 3 | 1 | 1 |")
  })
})
