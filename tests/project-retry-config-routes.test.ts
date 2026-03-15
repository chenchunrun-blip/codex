import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
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
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: retryConfigGet, PATCH: retryConfigPatch } = require("@/app/api/projects/[id]/retry-config/route")

describe("Project Retry Config Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("gets project retry config for member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_RETRYABLE_ERROR_CODES_UPDATED",
          retryableErrorCodes: ["AGENT_ENDPOINT_ERROR", "AGENT_EXECUTION_TIMEOUT"]
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/retry-config")
    const res = await retryConfigGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.retryableErrorCodes)).toBe(true)
    expect(data.retryableErrorCodes).toContain("AGENT_ENDPOINT_ERROR")
    expect(data.source).toBe("project")
  })

  it("updates retry config for editor", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/retry-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT", "AGENT_ENDPOINT_ERROR"]
      })
    })
    const res = await retryConfigPatch(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.retryableErrorCodes).toContain("AGENT_EXECUTION_TIMEOUT")
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("resets retry config to default", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/retry-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resetToDefault: true
      })
    })
    const res = await retryConfigPatch(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.retryableErrorCodes).toContain("AGENT_EXECUTION_TIMEOUT")
    expect(data.retryableErrorCodes).toContain("AGENT_ENDPOINT_ERROR")
    expect(data.retryableErrorCodes).toContain("AGENT_RUN_CONFLICT")
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })
})
