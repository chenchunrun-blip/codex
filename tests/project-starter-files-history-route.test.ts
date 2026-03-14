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
const { GET: historyGet } = require("@/app/api/projects/[id]/starter-files/history/route")

describe("Project Starter Files History Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns starter-pack history rows", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "single",
          dryRun: false,
          createdCount: 2,
          skippedCount: 1
        },
        user: {
          id: "user_1",
          name: "Alice",
          email: "u1@example.com"
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/history")
    const res = await historyGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.history)).toBe(true)
    expect(data.history[0].packId).toBe("PM_STARTER")
    expect(data.history[0].artifactType).toBe("PACK")
    expect(data.history[0].createdCount).toBe(2)
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "single",
          dryRun: false,
          createdCount: 2,
          skippedCount: 1
        },
        user: {
          id: "user_1",
          name: "Alice",
          email: "u1@example.com"
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/history?format=markdown")
    const res = await historyGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Project Starter Rollout History")
    expect(text).toContain("PM Starter")
  })

  it("includes template rollout rows", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T11:00:00.000Z"),
        metadata: {
          type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
          templateId: "tpl_1",
          templateName: "QA Test Plan (IT Delivery)",
          templateCategory: "SOLUTION_DESIGN",
          scope: "single",
          dryRun: true,
          wouldCreateCount: 1,
          skippedCount: 0
        },
        user: {
          id: "user_1",
          name: "Alice",
          email: "u1@example.com"
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/history")
    const res = await historyGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.history[0].artifactType).toBe("TEMPLATE")
    expect(data.history[0].templateName).toBe("QA Test Plan (IT Delivery)")
    expect(data.history[0].templateCategory).toBe("SOLUTION_DESIGN")
  })
})
