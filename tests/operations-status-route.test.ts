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
const { GET: operationsStatusGet } = require("@/app/api/operations/status/route")

describe("Operations Status Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns operations status json payload", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCH_BATCH_STARTED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_AUTO_DISPATCHED" } },
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_FAILED" } },
      { createdAt: now, action: "FILE_CREATED", metadata: { type: "TASKS_REPORT_SAVED" } }
    ])

    const req = new Request("http://localhost/api/operations/status")
    const res = await operationsStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.projectCount).toBe(1)
    expect(data.queueBacklogTotal).toBe(3)
    expect(data.scheduler.batchesStarted24h).toBe(1)
    expect(data.scheduler.autoDispatched24h).toBe(1)
    expect(data.agentRuns.failed24h).toBe(1)
    expect(data.reports.saved24h).toBe(1)
  })

  it("returns markdown when format=markdown", async () => {
    const now = new Date("2026-03-13T08:00:00.000Z")
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 2 } }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      { createdAt: now, action: "TASK_UPDATED", metadata: { type: "AGENT_RUN_TRIGGERED" } },
      { createdAt: now, action: "FILE_CREATED", metadata: { type: "OPERATIONS_STATUS_REPORT_SAVED" } }
    ])

    const req = new Request("http://localhost/api/operations/status?format=markdown")
    const res = await operationsStatusGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Operations Status Report")
    expect(text).toContain("Total Backlog: 2")
  })

  it("returns 403 when source project is inaccessible", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])

    const req = new Request("http://localhost/api/operations/status?sourceProjectId=p2")
    const res = await operationsStatusGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
