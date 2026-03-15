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
    task: {
      groupBy: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: operationsHealthGet } = require("@/app/api/operations/health/route")

describe("Operations Health Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns HEALTHY when no queue/failure pressure exists", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.groupBy.mockResolvedValue([])
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/operations/health")
    const res = await operationsHealthGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.health.level).toBe("HEALTHY")
    expect(data.health.issueCount).toBe(0)
  })

  it("returns CRITICAL when backlog and failures are high", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 45 } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_BATCH_STARTED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_TRIGGERED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } }
    ])

    const req = new Request("http://localhost/api/operations/health")
    const res = await operationsHealthGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.health.level).toBe("CRITICAL")
    expect(data.health.issueCount).toBeGreaterThan(0)
  })

  it("returns 403 when source project is inaccessible", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])

    const req = new Request("http://localhost/api/operations/health?sourceProjectId=p2")
    const res = await operationsHealthGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
