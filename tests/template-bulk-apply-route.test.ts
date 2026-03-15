import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    template: {
      findUnique: jest.fn()
    },
    projectMember: {
      findMany: jest.fn()
    },
    file: {
      count: jest.fn(),
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: templateBulkApplyPost } = require("@/app/api/templates/[id]/apply/route")

describe("Template Bulk Apply Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("applies template to editable projects", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_1",
      name: "PRD",
      category: "PROBLEM_DEFINITION",
      content: "# PRD",
      isBuiltIn: true,
      isPublic: true,
      creatorId: "user_2"
    })
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha" } },
      { projectId: "p2", role: "ADMIN", project: { id: "p2", name: "Beta" } }
    ])
    dbMock.file.count.mockResolvedValue(0)
    dbMock.file.create
      .mockResolvedValueOnce({ id: "f1" })
      .mockResolvedValueOnce({ id: "f2" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/templates/tpl_1/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectIds: ["p1", "p2"],
        dryRun: false,
        skipExistingByTemplateType: true
      })
    })
    const res = await templateBulkApplyPost(req, { params: Promise.resolve({ id: "tpl_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.createdTotal).toBe(2)
    expect(data.summary.failed).toBe(0)
    expect(dbMock.file.create).toHaveBeenCalledTimes(2)
    expect(dbMock.activityLog.create).toHaveBeenCalledTimes(2)
  })

  it("supports dry-run and membership failures", async () => {
    dbMock.template.findUnique.mockResolvedValue({
      id: "tpl_1",
      name: "PRD",
      category: "PROBLEM_DEFINITION",
      content: "# PRD",
      isBuiltIn: true,
      isPublic: true,
      creatorId: "user_2"
    })
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "p1", role: "EDITOR", project: { id: "p1", name: "Alpha" } }
    ])

    const req = new Request("http://localhost/api/templates/tpl_1/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectIds: ["p1", "p_missing"],
        dryRun: true
      })
    })
    const res = await templateBulkApplyPost(req, { params: Promise.resolve({ id: "tpl_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.wouldCreateTotal).toBe(1)
    expect(data.summary.failed).toBe(1)
    expect(dbMock.file.create).not.toHaveBeenCalled()
  })
})
