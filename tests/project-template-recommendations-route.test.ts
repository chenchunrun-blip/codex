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
    file: {
      groupBy: jest.fn()
    },
    template: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: recommendationGet } = require("@/app/api/projects/[id]/template-recommendations/route")

describe("Project Template Recommendations Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns project-usage recommendations for project member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "EDITOR"
    })
    dbMock.file.groupBy.mockResolvedValue([
      { templateType: "SOLUTION_DESIGN", _count: { _all: 3 } },
      { templateType: "EXECUTION_TRACKING", _count: { _all: 1 } }
    ])
    dbMock.template.findMany.mockResolvedValue([
      { id: "tpl_1", name: "Technical Design Document (IT R&D)", category: "SOLUTION_DESIGN" }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/template-recommendations")
    const res = await recommendationGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.recommendationSource).toBe("project_usage")
    expect(Array.isArray(data.templates)).toBe(true)
    expect(data.categories).toContain("SOLUTION_DESIGN")
  })

  it("returns fallback for empty project usage", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.file.groupBy.mockResolvedValue([])
    dbMock.template.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/proj_1/template-recommendations")
    const res = await recommendationGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.recommendationSource).toBe("builtin_fallback")
  })
})

