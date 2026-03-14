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
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: historyGet } = require("@/app/api/teams/[id]/starter-files/history/route")

describe("Team Starter Files History Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns team starter pack history for team member", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        projectId: "p1",
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "team_bulk",
          dryRun: false,
          createdCount: 3,
          skippedCount: 1
        },
        user: { id: "u1", name: "Owner", email: "owner@example.com" },
        project: { id: "p1", name: "Alpha" }
      },
      {
        projectId: "p1",
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
        metadata: { type: "OTHER_EVENT" },
        user: { id: "u1", name: "Owner", email: "owner@example.com" },
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/teams/team_1/starter-files/history")
    const res = await historyGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.teamId).toBe("team_1")
    expect(data.history).toHaveLength(1)
    expect(data.history[0]).toMatchObject({
      projectId: "p1",
      projectName: "Alpha",
      packId: "PM_STARTER",
      artifactType: "PACK",
      createdCount: 3
    })
  })

  it("returns 403 when requester is not in team", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue(null)
    const req = new Request("http://localhost/api/teams/team_1/starter-files/history")
    const res = await historyGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        projectId: "p1",
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "team_bulk",
          dryRun: false,
          createdCount: 3,
          skippedCount: 1
        },
        user: { id: "u1", name: "Owner", email: "owner@example.com" },
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/teams/team_1/starter-files/history?format=markdown")
    const res = await historyGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Team Starter Rollout History")
    expect(text).toContain("PM Starter")
  })

  it("includes template rollout history rows", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        projectId: "p2",
        createdAt: new Date("2026-03-12T01:00:00.000Z"),
        metadata: {
          type: "TEAM_TEMPLATE_ROLLOUT_APPLIED",
          templateId: "tpl_1",
          templateName: "QA Test Plan (IT Delivery)",
          templateCategory: "SOLUTION_DESIGN",
          scope: "team_bulk",
          dryRun: true,
          wouldCreateCount: 1,
          skippedCount: 0
        },
        user: { id: "u1", name: "Owner", email: "owner@example.com" },
        project: { id: "p2", name: "Beta" }
      }
    ])

    const req = new Request("http://localhost/api/teams/team_1/starter-files/history")
    const res = await historyGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.history).toHaveLength(1)
    expect(data.history[0]).toMatchObject({
      templateId: "tpl_1",
      templateName: "QA Test Plan (IT Delivery)",
      templateCategory: "SOLUTION_DESIGN",
      artifactType: "TEMPLATE",
      dryRun: true
    })
  })
})
