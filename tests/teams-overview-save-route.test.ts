import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findMany: jest.fn()
    },
    team: {
      findMany: jest.fn()
    },
    file: {
      create: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveTeamsOverviewPost } = require("@/app/api/teams/overview/save/route")

describe("Teams Overview Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.team.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Team A",
        description: "desc",
        createdAt: now,
        projects: [{ id: "p1" }],
        _count: { members: 3, projects: 2 }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        projectId: "p1",
        metadata: { type: "TEAM_STARTER_PACK_APPLIED" }
      },
      {
        projectId: "p1",
        metadata: { type: "PROJECT_TEMPLATE_ROLLOUT" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "teams-overview.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/teams/overview/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamsOverviewPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining("| Team A | desc | 3 | 2 | 2 |")
        })
      })
    )
  })

  it("returns 403 for viewer membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/teams/overview/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveTeamsOverviewPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
