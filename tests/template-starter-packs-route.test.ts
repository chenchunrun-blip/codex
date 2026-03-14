import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    template: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: starterPacksGet } = require("@/app/api/templates/starter-packs/route")

describe("Template Starter Packs Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns PM, IT, and Ops starter packs", async () => {
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION" },
      { id: "t2", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING" },
      { id: "t3", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY" },
      { id: "t4", name: "Technical Design Document (IT R&D)", category: "SOLUTION_DESIGN" },
      { id: "t5", name: "API Specification (Backend)", category: "SOLUTION_DESIGN" },
      { id: "t6", name: "Release Readiness Checklist", category: "EXECUTION_TRACKING" },
      { id: "t7", name: "Incident Postmortem (IT Ops)", category: "RETROSPECTIVE_SUMMARY" },
      { id: "t8", name: "Service Operations Runbook", category: "SOLUTION_DESIGN" }
    ])

    const req = new Request("http://localhost/api/templates/starter-packs")
    const res = await starterPacksGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.packs)).toBe(true)
    expect(data.packs.some((pack: any) => pack.id === "PM_STARTER")).toBe(true)
    expect(data.packs.some((pack: any) => pack.id === "IT_RD_STARTER")).toBe(true)
    expect(data.packs.some((pack: any) => pack.id === "OPS_INCIDENT_STARTER")).toBe(true)
  })

  it("includes expanded PM/IT preferred templates when available", async () => {
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION" },
      { id: "t2", name: "Product Requirement Document (PRD)", category: "PROBLEM_DEFINITION" },
      { id: "t3", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING" },
      { id: "t4", name: "Risk Register & Mitigation Plan", category: "EXECUTION_TRACKING" },
      { id: "t5", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY" },
      { id: "t6", name: "Technical Design Document (IT R&D)", category: "SOLUTION_DESIGN" },
      { id: "t7", name: "API Specification (Backend)", category: "SOLUTION_DESIGN" },
      { id: "t8", name: "Service Operations Runbook", category: "SOLUTION_DESIGN" },
      { id: "t9", name: "Data Migration Plan", category: "SOLUTION_DESIGN" },
      { id: "t10", name: "Release Readiness Checklist", category: "EXECUTION_TRACKING" },
      { id: "t11", name: "Incident Postmortem (IT Ops)", category: "RETROSPECTIVE_SUMMARY" }
    ])

    const req = new Request("http://localhost/api/templates/starter-packs")
    const res = await starterPacksGet(req)
    const data = await res.json()

    const pmPack = data.packs.find((pack: any) => pack.id === "PM_STARTER")
    const itPack = data.packs.find((pack: any) => pack.id === "IT_RD_STARTER")
    const opsPack = data.packs.find((pack: any) => pack.id === "OPS_INCIDENT_STARTER")

    expect(pmPack.templateIds).toEqual(
      expect.arrayContaining(["t1", "t2", "t3", "t4", "t5"])
    )
    expect(itPack.templateIds).toEqual(
      expect.arrayContaining(["t6", "t7", "t8", "t9", "t10"])
    )
    expect(opsPack.templateIds).toEqual(
      expect.arrayContaining(["t11", "t8", "t10"])
    )
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION" },
      { id: "t2", name: "Sprint Plan & Execution Board", category: "EXECUTION_TRACKING" },
      { id: "t3", name: "Retrospective Summary", category: "RETROSPECTIVE_SUMMARY" }
    ])

    const req = new Request("http://localhost/api/templates/starter-packs?format=markdown")
    const res = await starterPacksGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Template Starter Packs Catalog")
    expect(text).toContain("Project Charter (PM)")
  })
})
