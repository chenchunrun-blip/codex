import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: summaryGet } = require("@/app/api/projects/[id]/starter-files/summary/route")

describe("Project Starter Files Summary Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 7d and 30d rollout summaries", async () => {
    const now = Date.now()
    const d3 = new Date(now - 3 * 24 * 60 * 60 * 1000)
    const d10 = new Date(now - 10 * 24 * 60 * 60 * 1000)
    const d35 = new Date(now - 35 * 24 * 60 * 60 * 1000)

    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: d3,
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          dryRun: false,
          createdCount: 2,
          skippedCount: 1
        }
      },
      {
        createdAt: d10,
        metadata: {
          type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
          dryRun: true,
          createdCount: 0,
          skippedCount: 3
        }
      },
      {
        createdAt: d35,
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          dryRun: false,
          createdCount: 99,
          skippedCount: 99
        }
      },
      {
        createdAt: d3,
        metadata: {
          type: "OTHER_ACTIVITY"
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/summary")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.projectId).toBe("proj_1")
    expect(data.summary7d).toMatchObject({
      days: 7,
      runs: 1,
      packRuns: 1,
      templateRuns: 0,
      dryRuns: 0,
      createdTotal: 2,
      skippedTotal: 1
    })
    expect(data.summary30d).toMatchObject({
      days: 30,
      runs: 2,
      packRuns: 1,
      templateRuns: 1,
      dryRuns: 1,
      createdTotal: 2,
      skippedTotal: 4
    })
  })

  it("returns 403 when requester is not a project member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/summary")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1"
    })
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/summary?format=markdown")
    const res = await summaryGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Project Starter Rollout Summary")
  })
})
