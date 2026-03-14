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
const {
  GET: schedulerConfigGet,
  PATCH: schedulerConfigPatch
} = require("@/app/api/projects/[id]/scheduler-config/route")

describe("Project Scheduler Config Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("gets scheduler config for project member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_SCHEDULER_CONFIG_UPDATED",
          enabled: true,
          defaultLimit: 8,
          defaultAutoSubmit: false
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/scheduler-config")
    const res = await schedulerConfigGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.enabled).toBe(true)
    expect(data.defaultLimit).toBe(8)
    expect(data.defaultAutoSubmit).toBe(false)
  })

  it("updates scheduler config for editor", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/scheduler-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        defaultLimit: 4,
        defaultAutoSubmit: true
      })
    })

    const res = await schedulerConfigPatch(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.enabled).toBe(false)
    expect(data.defaultLimit).toBe(4)
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })
})
