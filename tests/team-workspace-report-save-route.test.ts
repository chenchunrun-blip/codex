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
    projectMember: {
      findMany: jest.fn()
    },
    team: {
      findUnique: jest.fn()
    },
    file: {
      groupBy: jest.fn(),
      count: jest.fn(),
      create: jest.fn()
    },
    task: {
      count: jest.fn()
    },
    template: {
      findMany: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveTeamWorkspacePost } = require("@/app/api/teams/[id]/workspace-report/save/route")

describe("Team Workspace Report Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves report for editable project in team", async () => {
    const now = new Date("2026-03-12T12:00:00.000Z")
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha Project", updatedAt: now }
      }
    ])
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      name: "Alpha Team",
      description: "Team A",
      creator: { name: "Owner", email: "owner@example.com" },
      projects: [{ id: "p1", name: "Alpha Project", status: "ACTIVE" }]
    })
    dbMock.file.groupBy.mockResolvedValue([])
    dbMock.file.count.mockResolvedValue(5)
    dbMock.task.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1)
    dbMock.template.findMany.mockResolvedValue([])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "team-workspace-report.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/teams/team_1/workspace-report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamWorkspacePost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 when user is not a team member", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue(null)

    const req = new Request("http://localhost/api/teams/team_1/workspace-report/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamWorkspacePost(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })
})
