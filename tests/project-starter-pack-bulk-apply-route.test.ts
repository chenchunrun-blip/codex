import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
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
const { POST: bulkApplyPost } = require("@/app/api/projects/starter-files/bulk-apply-pack/route")

describe("Project Starter Pack Bulk Apply Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("applies pack across editable projects", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR" },
      { projectId: "p2", role: "VIEWER" }
    ])
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ])
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION", content: "# c1" },
      { id: "t2", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING", content: "# c2" },
      { id: "t3", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY", content: "# c3" }
    ])
    dbMock.file.findMany.mockResolvedValue([])
    dbMock.file.create
      .mockResolvedValueOnce({ id: "f1" })
      .mockResolvedValueOnce({ id: "f2" })
      .mockResolvedValueOnce({ id: "f3" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/starter-files/bulk-apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "PM_STARTER",
        projectIds: ["p1", "p2"]
      })
    })
    const res = await bulkApplyPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.successCount).toBe(1)
    expect(data.failedCount).toBe(1)
    expect(data.results.find((r: any) => r.projectId === "p1")?.projectName).toBe("Alpha")
    expect(data.results.find((r: any) => r.projectId === "p2")?.projectName).toBe("Beta")
    expect(data.results.find((r: any) => r.projectId === "p2")?.message).toBe("INSUFFICIENT_PERMISSIONS")
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_STARTER_PACK_APPLIED",
            scope: "bulk",
            dryRun: false
          })
        })
      })
    )
  })

  it("supports dry run mode", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR" }
    ])
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha" }
    ])
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION", content: "# c1" }
    ])
    dbMock.file.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/starter-files/bulk-apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: "PM_STARTER",
        projectIds: ["p1"],
        dryRun: true
      })
    })
    const res = await bulkApplyPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(data.results[0].projectName).toBe("Alpha")
    expect(data.results[0].wouldCreateCount).toBe(1)
    expect(dbMock.file.create).not.toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_STARTER_PACK_APPLIED",
            scope: "bulk",
            dryRun: true
          })
        })
      })
    )
  })
})
