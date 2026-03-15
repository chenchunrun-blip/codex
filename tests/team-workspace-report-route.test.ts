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
    file: {
      groupBy: jest.fn(),
      count: jest.fn()
    },
    task: {
      count: jest.fn()
    },
    template: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: teamWorkspaceGet } = require("@/app/api/teams/[id]/workspace-report/route")

describe("Team Workspace Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns JSON report for team member", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
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

    const req = new Request("http://localhost/api/teams/team_1/workspace-report")
    const res = await teamWorkspaceGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.team.id).toBe("team_1")
    expect(data.overview.projectCount).toBe(1)
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm1" })
    dbMock.team.findUnique.mockResolvedValue({
      id: "team_1",
      name: "Alpha Team",
      description: null,
      creator: { name: "Owner", email: "owner@example.com" },
      projects: [{ id: "p1", name: "Alpha Project", status: "ACTIVE" }]
    })
    dbMock.file.groupBy.mockResolvedValue([])
    dbMock.file.count.mockResolvedValue(5)
    dbMock.task.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1)
    dbMock.template.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/teams/team_1/workspace-report?format=markdown")
    const res = await teamWorkspaceGet(req, { params: Promise.resolve({ id: "team_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Team Workspace Report")
    expect(text).toContain("Alpha Team")
  })
})
