import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    teamMember: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: aggregateHistoryGet } = require("@/app/api/teams/starter-files/history/route")

describe("Teams Starter Files History Aggregate Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns aggregate history rows", async () => {
    dbMock.teamMember.findMany.mockResolvedValue([
      { teamId: "t1", team: { id: "t1", name: "Team A" } },
      { teamId: "t2", team: { id: "t2", name: "Team B" } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-13T11:00:00.000Z"),
        projectId: "p1",
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          createdCount: 2,
          skippedCount: 1
        },
        user: { id: "u1", name: "Alice", email: "u1@example.com" },
        project: { id: "p1", name: "Alpha", teamId: "t1" }
      }
    ])

    const req = new Request("http://localhost/api/teams/starter-files/history")
    const res = await aggregateHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.teamIds).toEqual(["t1", "t2"])
    expect(data.history).toHaveLength(1)
    expect(data.history[0].teamName).toBe("Team A")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.teamMember.findMany.mockResolvedValue([
      { teamId: "t1", team: { id: "t1", name: "Team A" } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-13T11:00:00.000Z"),
        projectId: "p1",
        metadata: {
          type: "TEAM_TEMPLATE_ROLLOUT_APPLIED",
          templateId: "tpl_1",
          templateName: "QA Plan",
          templateCategory: "SOLUTION_DESIGN",
          dryRun: true,
          wouldCreateCount: 1,
          skippedCount: 0
        },
        user: { id: "u1", name: "Alice", email: "u1@example.com" },
        project: { id: "p1", name: "Alpha", teamId: "t1" }
      }
    ])

    const req = new Request("http://localhost/api/teams/starter-files/history?format=markdown")
    const res = await aggregateHistoryGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Teams Starter Rollout History")
    expect(text).toContain("QA Plan")
  })

  it("returns 403 for inaccessible team", async () => {
    dbMock.teamMember.findMany.mockResolvedValue([
      { teamId: "t1", team: { id: "t1", name: "Team A" } }
    ])

    const req = new Request("http://localhost/api/teams/starter-files/history?teamId=t2")
    const res = await aggregateHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })
})
