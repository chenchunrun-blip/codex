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
const { POST: saveProjectStarterHistoryPost } = require("@/app/api/projects/starter-files/history/save/route")

describe("Project Starter History Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves history for editable project", async () => {
    const now = new Date("2026-03-12T12:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha Project", updatedAt: now }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: {
          type: "PROJECT_STARTER_PACK_APPLIED",
          packId: "PM_STARTER",
          packName: "PM Starter",
          scope: "single",
          dryRun: false,
          createdCount: 3,
          skippedCount: 1
        },
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "project-starter-pack-history.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/starter-files/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveProjectStarterHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
    const fileCreateArgs = dbMock.file.create.mock.calls[0]?.[0]
    expect(fileCreateArgs.data.name).toContain("project-starter-rollout-history-")
    expect(fileCreateArgs.data.content).toContain("# Project Starter Rollout History - Alpha Project")
  })

  it("returns 403 when no editable project exists", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha Project", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/projects/starter-files/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveProjectStarterHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NO_EDITABLE_PROJECT")
  })

  it("includes template rollout logs in saved markdown", async () => {
    const now = new Date("2026-03-12T13:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha Project", updatedAt: now }
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
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
        user: { name: "Owner", email: "owner@example.com" }
      }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f2",
      name: "project-starter-rollout-history.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/starter-files/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveProjectStarterHistoryPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f2")
    const fileCreateArgs = dbMock.file.create.mock.calls[0]?.[0]
    expect(fileCreateArgs.data.content).toContain("QA Test Plan (IT Delivery)")
    expect(fileCreateArgs.data.content).toContain("SOLUTION_DESIGN")
  })
})
