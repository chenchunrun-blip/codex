import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { ActionType, AssigneeType, TaskStatus } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_actor", email: "actor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    task: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: metricsGet } = require("@/app/api/tasks/metrics/route")

describe("Task Metrics Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns metrics for all member projects", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([
      { projectId: "proj_1" },
      { projectId: "proj_2" }
    ])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 2 } },
      { functionalAgentType: "QA", _count: { _all: 1 } }
    ])
    dbMock.task.findMany
      .mockResolvedValueOnce([
        {
          startedAt: new Date("2026-03-10T00:00:00.000Z"),
          completedAt: new Date("2026-03-10T02:00:00.000Z")
        }
      ])
    dbMock.task.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    dbMock.activityLog.findMany.mockResolvedValue([
      { metadata: { type: "AGENT_RUN_TRIGGERED" }, action: ActionType.TASK_UPDATED },
      { metadata: { type: "AGENT_AUTO_DISPATCHED" }, action: ActionType.TASK_UPDATED },
      { metadata: { type: "AGENT_RUN_FAILED", error: "timeout" }, action: ActionType.TASK_UPDATED }
    ])
    dbMock.activityLog.findMany.mockResolvedValueOnce([
      { metadata: { type: "AGENT_RUN_TRIGGERED" }, action: ActionType.TASK_UPDATED },
      { metadata: { type: "AGENT_AUTO_DISPATCHED" }, action: ActionType.TASK_UPDATED },
      { metadata: { type: "AGENT_RUN_FAILED", error: "timeout" }, action: ActionType.TASK_UPDATED }
    ]).mockResolvedValueOnce([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED",
          batchId: "batch_1",
          total: 2,
          successCount: 1,
          failedCount: 1,
          triggerMode: "MANUAL",
          idempotencyKey: "idem_1"
        }
      }
    ])

    const req = new Request("http://localhost/api/tasks/metrics")
    const res = await metricsGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.backlog.total).toBe(3)
    expect(Array.isArray(data.retryableErrorCodes)).toBe(true)
    expect(data.retryableErrorCodes).toContain("AGENT_EXECUTION_TIMEOUT")
    expect(data.dispatchPolicyOnlineOnly).toBeNull()
    expect(data.dispatchPolicySource).toBe("mixed")
    expect(data.execution.runs).toBe(2)
    expect(data.execution.failed).toBe(1)
    expect(data.execution.successRate).toBe(50)
    expect(data.completion.avgCompletionHours).toBe(2)
    expect(data.risk.total).toBe(3)
    expect(data.risk.overdue).toBe(1)
    expect(data.risk.dueIn24h).toBe(1)
    expect(data.risk.dueIn3d).toBe(1)
    expect(data.failures[0].reason).toBe("timeout")
    expect(data.dispatchHistory.length).toBe(1)
    expect(data.dispatchHistory[0].batchId).toBe("batch_1")
  })

  it("rejects access when projectId is not accessible", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/metrics?projectId=proj_1")
    const res = await metricsGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("falls back when FUNCTIONAL_AGENT backlog query is incompatible", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "proj_1" }])
    dbMock.task.groupBy.mockRejectedValue(new Error("groupBy unsupported"))
    dbMock.task.findMany.mockImplementation(async (args: any) => {
      const where = args?.where || {}
      if (where?.status === TaskStatus.PENDING && where?.assigneeType === AssigneeType.FUNCTIONAL_AGENT) {
        throw new Error("Invalid enum value FUNCTIONAL_AGENT")
      }
      if (where?.status === TaskStatus.PENDING && where?.assigneeType === AssigneeType.AGENT) {
        return [{ functionalAgentType: "ENGINEERING" }]
      }
      if (where?.completedAt?.gte) {
        return [
          {
            startedAt: new Date("2026-03-10T00:00:00.000Z"),
            completedAt: new Date("2026-03-10T01:00:00.000Z")
          }
        ]
      }
      if (where?.dueDate?.not === null) {
        return []
      }
      return []
    })
    dbMock.task.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/tasks/metrics")
    const res = await metricsGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.backlog.total).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(data.backlog.byQueueDomain)).toBe(true)
    expect(
      dbMock.task.findMany.mock.calls.some(
        ([args]: any[]) =>
          args?.where?.status === TaskStatus.PENDING &&
          args?.where?.assigneeType === AssigneeType.AGENT
      )
    ).toBe(true)
  })

  it("returns degraded payload when unexpected error occurs", async () => {
    dbMock.projectMember.findMany.mockRejectedValue(new Error("db unavailable"))

    const req = new Request("http://localhost/api/tasks/metrics?days=14")
    const res = await metricsGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.degraded).toBe(true)
    expect(data.error).toBe("Failed to fetch task metrics")
    expect(data.backlog.total).toBe(0)
    expect(data.execution.runs).toBe(0)
  })

  it("marks response degraded when activity log scan is truncated", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "proj_1" }])
    dbMock.task.groupBy.mockResolvedValue([{ functionalAgentType: "ENGINEERING", _count: { _all: 1 } }])
    dbMock.task.findMany.mockResolvedValue([
      {
        startedAt: new Date("2026-03-10T00:00:00.000Z"),
        completedAt: new Date("2026-03-10T01:00:00.000Z")
      }
    ])
    dbMock.task.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)

    const logs = Array.from({ length: 1201 }).map(() => ({
      metadata: { type: "AGENT_RUN_TRIGGERED" },
      action: ActionType.TASK_UPDATED
    }))
    dbMock.activityLog.findMany
      .mockResolvedValueOnce(logs)
      .mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/tasks/metrics")
    const res = await metricsGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.degraded).toBe(true)
    expect(data.execution.runs).toBe(1200)
  })
})
