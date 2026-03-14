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
const { POST: saveProjectStarterSummaryPost } = require("@/app/api/projects/[id]/starter-files/summary/save/route")

describe("Project Starter Summary Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves summary report for editable member", async () => {
    const now = new Date("2026-03-12T12:00:00.000Z")
    dbMock.projectMember.findUnique.mockResolvedValue({
      role: "EDITOR",
      project: { id: "p1", name: "Alpha Project" }
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          createdCount: 2,
          skippedCount: 1,
          dryRun: false
        }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "project-starter-rollout-summary.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/p1/starter-files/summary/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveProjectStarterSummaryPost(req, { params: Promise.resolve({ id: "p1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
    const fileCreateArgs = dbMock.file.create.mock.calls[0]?.[0]
    expect(fileCreateArgs.data.content).toContain("# Project Starter Rollout Summary - Alpha Project")
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer role", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      role: "VIEWER",
      project: { id: "p1", name: "Alpha Project" }
    })

    const req = new Request("http://localhost/api/projects/p1/starter-files/summary/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveProjectStarterSummaryPost(req, { params: Promise.resolve({ id: "p1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
