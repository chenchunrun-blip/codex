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
    team: {
      findUnique: jest.fn()
    },
    projectMember: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    file: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveTeamStarterSummaryPost } = require("@/app/api/teams/[id]/starter-files/summary/save/route")

describe("Team Starter Summary Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves summary report for editable team project", async () => {
    const now = new Date("2026-03-12T12:00:00.000Z")
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.team.findUnique.mockResolvedValue({ id: "team_1", name: "Alpha Team" })
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha Project", updatedAt: now }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        projectId: "p1",
        project: { id: "p1", name: "Alpha Project" },
        metadata: {
          type: "TEAM_STARTER_PACK_APPLIED",
          createdCount: 3,
          skippedCount: 1,
          dryRun: false
        }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "team-starter-rollout-summary.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/teams/team_1/starter-files/summary/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamStarterSummaryPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    const fileCreateArgs = dbMock.file.create.mock.calls[0]?.[0]
    expect(fileCreateArgs.data.content).toContain("# Team Starter Rollout Summary - Alpha Team")
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 when user is not team member", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue(null)

    const req = new Request("http://localhost/api/teams/team_1/starter-files/summary/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamStarterSummaryPost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })
})
