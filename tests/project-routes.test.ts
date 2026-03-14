import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    teamMember: {
      findUnique: jest.fn()
    },
    project: {
      create: jest.fn()
    },
    template: {
      findMany: jest.fn()
    },
    file: {
      createMany: jest.fn(),
      findMany: jest.fn()
    },
    activityLog: {
      createMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: projectPost } = require("@/app/api/projects/route")

describe("Project Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates project without starter templates", async () => {
    dbMock.teamMember.findUnique.mockResolvedValue({
      teamId: "team_1",
      userId: "user_1",
      role: "ADMIN"
    })
    dbMock.project.create.mockResolvedValue({
      id: "proj_1",
      name: "Alpha",
      description: "desc",
      teamId: "team_1",
      members: [],
      team: { id: "team_1", name: "Team One" }
    })

    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alpha",
        description: "desc",
        teamId: "team_1"
      })
    })
    const res = await projectPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.id).toBe("proj_1")
    expect(data.starterTemplatesApplied).toBe(0)
  })

  it("creates starter files from selected templates", async () => {
    dbMock.teamMember.findUnique.mockResolvedValue({
      teamId: "team_1",
      userId: "user_1",
      role: "ADMIN"
    })
    dbMock.project.create.mockResolvedValue({
      id: "proj_2",
      name: "Beta",
      description: null,
      teamId: "team_1",
      members: [],
      team: { id: "team_1", name: "Team One" }
    })
    dbMock.template.findMany.mockResolvedValue([
      {
        id: "tpl_1",
        name: "Project Charter (PM)",
        category: "PROBLEM_DEFINITION",
        content: "# Charter"
      }
    ])
    dbMock.file.createMany.mockResolvedValue({ count: 1 })
    dbMock.file.findMany.mockResolvedValue([
      { id: "file_1", templateType: "PROBLEM_DEFINITION" }
    ])
    dbMock.activityLog.createMany.mockResolvedValue({ count: 1 })

    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Beta",
        teamId: "team_1",
        starterTemplateIds: ["tpl_1"]
      })
    })
    const res = await projectPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.starterTemplatesApplied).toBe(1)
    expect(dbMock.template.findMany).toHaveBeenCalled()
    expect(dbMock.file.createMany).toHaveBeenCalled()
    expect(dbMock.activityLog.createMany).toHaveBeenCalled()
  })

  it("rejects create when user is not a team member", async () => {
    dbMock.teamMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Gamma",
        teamId: "team_1"
      })
    })
    const res = await projectPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_TEAM_MEMBER")
  })
})
