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
const { POST: starterFilesPost } = require("@/app/api/projects/[id]/starter-files/route")

describe("Project Starter Files Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("applies templates and skips existing templateType files", async () => {
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
      { id: "t2", name: "Technical Design Document (IT R&D)", category: "SOLUTION_DESIGN", content: "# c2" }
    ])
    dbMock.file.findMany.mockResolvedValue([{ templateType: "PROBLEM_DEFINITION" }])
    dbMock.file.create.mockResolvedValue({ id: "file_2" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/starter-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: ["t1", "t2"],
        skipExistingByTemplateType: true
      })
    })
    const res = await starterFilesPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.createdCount).toBe(1)
    expect(data.skippedCount).toBe(1)
  })

  it("rejects viewer role", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/projects/proj_1/starter-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateIds: ["t1"]
      })
    })
    const res = await starterFilesPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})

