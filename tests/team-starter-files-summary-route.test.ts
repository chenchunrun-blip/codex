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
const { GET: summaryGet } = require("@/app/api/teams/[id]/starter-files/summary/route")

describe("Team Starter Files Summary Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 7d and 30d team rollout summaries", async () => {
    const now = Date.now()
    const d2 = new Date(now - 2 * 24 * 60 * 60 * 1000)
    const d15 = new Date(now - 15 * 24 * 60 * 60 * 1000)
    const d40 = new Date(now - 40 * 24 * 60 * 60 * 1000)

    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm_1" })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: d2,
        metadata: {
          type: "TEAM_TEMPLATE_ROLLOUT_APPLIED",
          dryRun: true,
          createdCount: 0,
          skippedCount: 2
        }
      },
      {
        createdAt: d15,
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          dryRun: false,
          createdCount: 5,
          skippedCount: 1
        }
      },
      {
        createdAt: d40,
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          dryRun: false,
          createdCount: 100,
          skippedCount: 100
        }
      }
    ])

    const req = new Request("http://localhost/api/teams/team_1/starter-files/summary")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.teamId).toBe("team_1")
    expect(data.summary7d).toMatchObject({
      days: 7,
      runs: 1,
      packRuns: 0,
      templateRuns: 1,
      dryRuns: 1,
      createdTotal: 0,
      skippedTotal: 2
    })
    expect(data.summary30d).toMatchObject({
      days: 30,
      runs: 2,
      packRuns: 1,
      templateRuns: 1,
      dryRuns: 1,
      createdTotal: 5,
      skippedTotal: 3
    })
  })

  it("returns 403 when requester is not a team member", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue(null)

    const req = new Request("http://localhost/api/teams/team_1/starter-files/summary")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm_1" })
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/teams/team_1/starter-files/summary?format=markdown")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Team Starter Rollout Summary")
  })
})
