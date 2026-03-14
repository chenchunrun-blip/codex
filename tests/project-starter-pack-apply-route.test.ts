import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    project: {
      findUnique: jest.fn()
    },
    template: {
      findMany: jest.fn()
    },
    file: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: applyPackPost } = require("@/app/api/projects/[id]/starter-files/apply-pack/route")

describe("Project Starter Pack Apply Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("applies PM pack and creates files", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION", content: "# c1" },
      { id: "t2", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING", content: "# c2" },
      { id: "t3", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY", content: "# c3" }
    ])
    dbMock.file.findMany.mockResolvedValue([])
    dbMock.file.create
      .mockResolvedValueOnce({ id: "file_1" })
      .mockResolvedValueOnce({ id: "file_2" })
      .mockResolvedValueOnce({ id: "file_3" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "PM_STARTER"
      })
    })
    const res = await applyPackPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.packId).toBe("PM_STARTER")
    expect(data.createdCount).toBe(3)
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_STARTER_PACK_APPLIED",
            scope: "single",
            dryRun: false
          })
        })
      })
    )
  })

  it("returns 404 when pack cannot be resolved", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.template.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "PM_STARTER"
      })
    })
    const res = await applyPackPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("STARTER_PACK_NOT_FOUND")
  })

  it("supports dry run without creating files", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION", content: "# c1" }
    ])
    dbMock.file.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "PM_STARTER",
        dryRun: true
      })
    })
    const res = await applyPackPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(data.wouldCreateCount).toBe(1)
    expect(dbMock.file.create).not.toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_STARTER_PACK_APPLIED",
            dryRun: true
          })
        })
      })
    )
  })
})
