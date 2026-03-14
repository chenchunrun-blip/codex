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
      findFirst: jest.fn()
    },
    file: {
      findFirst: jest.fn(),
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: applyTemplatePost } = require("@/app/api/projects/[id]/starter-files/apply-template/route")

describe("Project Template Rollout Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("applies template for editable member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.template.findFirst.mockResolvedValue({
      id: "tpl_1",
      name: "QA Test Plan (IT Delivery)",
      category: "SOLUTION_DESIGN",
      content: "# qa"
    })
    dbMock.file.findFirst.mockResolvedValue(null)
    dbMock.file.create.mockResolvedValue({ id: "file_1" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/apply-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: "tpl_1"
      })
    })
    const res = await applyTemplatePost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.templateId).toBe("tpl_1")
    expect(data.createdCount).toBe(1)
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_TEMPLATE_ROLLOUT_APPLIED",
            dryRun: false
          })
        })
      })
    )
  })

  it("supports dry run", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha"
    })
    dbMock.template.findFirst.mockResolvedValue({
      id: "tpl_1",
      name: "QA Test Plan (IT Delivery)",
      category: "SOLUTION_DESIGN",
      content: "# qa"
    })
    dbMock.file.findFirst.mockResolvedValue(null)
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/starter-files/apply-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: "tpl_1",
        dryRun: true
      })
    })
    const res = await applyTemplatePost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dryRun).toBe(true)
    expect(data.wouldCreateCount).toBe(1)
    expect(dbMock.file.create).not.toHaveBeenCalled()
  })
})
