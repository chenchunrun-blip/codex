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
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: aggregateHistoryGet } = require("@/app/api/projects/starter-files/history/route")

describe("Projects Starter Files History Aggregate Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns aggregate history rows", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", project: { id: "p1", name: "Alpha" } },
      { projectId: "p2", project: { id: "p2", name: "Beta" } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-13T10:00:00.000Z"),
        projectId: "p1",
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "single",
          dryRun: false,
          createdCount: 2,
          skippedCount: 1
        },
        user: { id: "u1", name: "Alice", email: "u1@example.com" },
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/projects/starter-files/history")
    const res = await aggregateHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.sourceProjectIds).toEqual(["p1", "p2"])
    expect(data.history).toHaveLength(1)
    expect(data.history[0].projectName).toBe("Alpha")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", project: { id: "p1", name: "Alpha" } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-13T10:00:00.000Z"),
        projectId: "p1",
        metadata: {
          type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
          templateId: "tpl_1",
          templateName: "QA Plan",
          templateCategory: "SOLUTION_DESIGN",
          dryRun: true,
          wouldCreateCount: 1,
          skippedCount: 0
        },
        user: { id: "u1", name: "Alice", email: "u1@example.com" },
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/projects/starter-files/history?format=markdown")
    const res = await aggregateHistoryGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Projects Starter Rollout History")
    expect(text).toContain("QA Plan")
  })

  it("returns 403 for inaccessible source project", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", project: { id: "p1", name: "Alpha" } }
    ])

    const req = new Request("http://localhost/api/projects/starter-files/history?sourceProjectId=p2")
    const res = await aggregateHistoryGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
