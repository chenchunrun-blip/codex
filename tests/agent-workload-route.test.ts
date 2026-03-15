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
    agent: {
      findMany: jest.fn()
    },
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: workloadGet } = require("@/app/api/agents/workload/route")

describe("Agent Workload Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns per-agent workload and run stats", async () => {
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        name: "eng-agent",
        displayName: "Engineering Agent",
        capabilities: ["engineering"],
        isActive: true,
        updatedAt: new Date("2026-03-12T10:00:00.000Z")
      },
      {
        id: "agent_2",
        name: "qa-agent",
        displayName: "QA Agent",
        capabilities: ["qa"],
        isActive: true,
        updatedAt: new Date("2026-03-12T09:30:00.000Z")
      }
    ])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } },
      { functionalAgentType: "QA", _count: { _all: 1 } }
    ])
    dbMock.task.findMany.mockResolvedValue([
      { id: "task_1", agentId: "agent_1", status: "IN_PROGRESS" },
      { id: "task_2", agentId: "agent_1", status: "PENDING" },
      { id: "task_3", agentId: "agent_2", status: "REVIEW" }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        taskId: "task_1",
        createdAt: new Date("2026-03-12T10:10:00.000Z"),
        metadata: { type: "AGENT_RUN_FAILED", error: "timeout" }
      },
      {
        taskId: "task_2",
        createdAt: new Date("2026-03-12T09:50:00.000Z"),
        metadata: { type: "AGENT_RUN_TRIGGERED" }
      }
    ])

    const req = new Request("http://localhost/api/agents/workload")
    const res = await workloadGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.summary.totalAgents).toBe(2)
    expect(data.summary.totalActiveTasks).toBe(3)
    expect(data.summary.failedRunsInWindow).toBe(1)
    expect(data.agents.find((a: any) => a.id === "agent_1")?.workload.activeTasks).toBe(2)
    expect(data.agents.find((a: any) => a.id === "agent_1")?.queuePressure.backlog).toBe(3)
  })

  it("checks project membership when projectId is provided", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/agents/workload?projectId=proj_1")
    const res = await workloadGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        name: "eng-agent",
        displayName: "Engineering Agent",
        capabilities: ["engineering"],
        isActive: true,
        updatedAt: new Date("2026-03-12T10:00:00.000Z")
      }
    ])
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 2 } }
    ])
    dbMock.task.findMany.mockResolvedValue([
      { id: "task_1", agentId: "agent_1", status: "IN_PROGRESS" }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/agents/workload?format=markdown")
    const res = await workloadGet(req)
    const markdown = await res.text()

    expect(res.status).toBe(200)
    expect(markdown).toContain("# Agent Workload Report")
    expect(markdown).toContain("Engineering Agent")
    expect(markdown).toContain("ALL_ACCESSIBLE")
  })
})
