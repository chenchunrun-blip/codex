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
    project: {
      findMany: jest.fn()
    },
    file: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: savePortfolioPost } = require("@/app/api/projects/portfolio/save/route")

describe("Projects Portfolio Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves portfolio report for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])
    dbMock.project.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "Alpha",
        status: "ACTIVE",
        updatedAt: now,
        team: { name: "Team A" },
        _count: { files: 4, members: 3 }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "projects-portfolio.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await savePortfolioPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer-only membership", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "VIEWER", project: { id: "p1", name: "Alpha", updatedAt: now } }
    ])

    const req = new Request("http://localhost/api/projects/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await savePortfolioPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
