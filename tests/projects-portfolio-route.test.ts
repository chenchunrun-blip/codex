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
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: projectsPortfolioGet } = require("@/app/api/projects/portfolio/route")

describe("Projects Portfolio Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json portfolio payload", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
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

    const req = new Request("http://localhost/api/projects/portfolio")
    const res = await projectsPortfolioGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.projects[0].name).toBe("Alpha")
    expect(data.projects[0].teamName).toBe("Team A")
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
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

    const req = new Request("http://localhost/api/projects/portfolio?format=markdown")
    const res = await projectsPortfolioGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Projects Portfolio Report")
    expect(text).toContain("| Alpha | Team A | ACTIVE | 4 | 3 |")
  })

  it("returns 403 when source project is inaccessible", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])

    const req = new Request("http://localhost/api/projects/portfolio?sourceProjectId=p2")
    const res = await projectsPortfolioGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
