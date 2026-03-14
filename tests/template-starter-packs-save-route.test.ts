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
    template: {
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
const { POST: saveStarterPacksPost } = require("@/app/api/templates/starter-packs/save/route")

describe("Template Starter Packs Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves starter packs catalog for editable project", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "EDITOR",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION" },
      { id: "t2", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING" },
      { id: "t3", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY" }
    ])
    dbMock.file.create.mockResolvedValue({
      id: "f1",
      name: "template-starter-packs.md",
      projectId: "p1",
      createdAt: now
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/templates/starter-packs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveStarterPacksPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.file.id).toBe("f1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("returns 403 for viewer-only memberships", async () => {
    const now = new Date()
    dbMock.projectMember.findMany.mockResolvedValue([
      {
        projectId: "p1",
        role: "VIEWER",
        project: { id: "p1", name: "Alpha", updatedAt: now }
      }
    ])

    const req = new Request("http://localhost/api/templates/starter-packs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    const res = await saveStarterPacksPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NO_EDITABLE_PROJECT")
  })
})
