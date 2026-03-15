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
    project: {
      findUnique: jest.fn()
    },
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn()
    },
    agent: {
      count: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

jest.mock("@/lib/tasks/dispatch-policy", () => ({
  resolveProjectDispatchPolicy: jest.fn(async () => ({
    onlineOnly: true,
    source: "project",
    updatedAt: "2026-03-12T09:00:00.000Z"
  }))
}))

jest.mock("@/lib/tasks/project-bottlenecks", () => ({
  resolveProjectBottlenecks: jest.fn(async () => ({
    queueBacklog: [{ domain: "ENGINEERING", backlog: 3, onlineAgents: 0 }],
    atRiskDomains: [{ domain: "ENGINEERING", backlog: 3, onlineAgents: 0 }],
    highRiskTasks: [],
    recommendations: [
      {
        type: "QUEUE",
        title: "Queue domain ENGINEERING has backlog 3 with no online agents",
        action: "Bring at least one ENGINEERING agent online"
      }
    ]
  }))
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: workspaceReportGet } = require("@/app/api/projects/[id]/workspace-report/route")

describe("Workspace Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns markdown report as json payload", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({ role: "EDITOR" })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha",
      description: "Test",
      status: "ACTIVE",
      createdAt: new Date("2026-03-12T00:00:00.000Z"),
      team: { id: "team_1", name: "Core Team" },
      _count: { files: 3, members: 5 }
    })
    dbMock.task.groupBy
      .mockResolvedValueOnce([
        { status: "PENDING", _count: { _all: 4 } },
        { status: "IN_PROGRESS", _count: { _all: 2 } }
      ])
      .mockResolvedValueOnce([{ functionalAgentType: "ENGINEERING", _count: { _all: 3 } }])
    dbMock.agent.count.mockResolvedValue(4)
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date("2026-03-12T12:00:00.000Z"),
          metadata: {
            type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED",
            successCount: 2,
            failedCount: 1,
            triggerMode: "MANUAL"
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          taskId: "task_1",
          createdAt: new Date("2026-03-12T12:10:00.000Z"),
          metadata: {
            type: "AGENT_RUN_FAILED",
            error: "timeout"
          }
        }
      ])
    dbMock.task.findMany
      .mockResolvedValueOnce([{ id: "task_1", title: "Task 1" }])
      .mockResolvedValueOnce([
        {
          id: "task_risk_1",
          title: "Hotfix API",
          status: "IN_PROGRESS",
          dueDate: new Date("2026-03-13T00:00:00.000Z")
        }
      ])

    const req = new Request("http://localhost/api/projects/proj_1/workspace-report")
    const res = await workspaceReportGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(typeof data.markdown).toBe("string")
    expect(data.markdown).toContain("Workspace Report - Alpha")
    expect(data.markdown).toContain("Recent Agent Runs")
    expect(data.markdown).toContain("High Risk Tasks")
    expect(data.markdown).toContain("Agent Dispatch Policy")
    expect(data.markdown).toContain("At-Risk Queue Domains")
    expect(data.metrics.activeAgents).toBe(4)
    expect(data.metrics.dispatchPolicy.onlineOnly).toBe(true)
    expect(Array.isArray(data.metrics.atRiskDomains)).toBe(true)
  })

  it("returns text/markdown response when format=markdown", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({ role: "VIEWER" })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha",
      description: "Test",
      status: "ACTIVE",
      createdAt: new Date("2026-03-12T00:00:00.000Z"),
      team: { id: "team_1", name: "Core Team" },
      _count: { files: 1, members: 2 }
    })
    dbMock.task.groupBy
      .mockResolvedValueOnce([{ status: "PENDING", _count: { _all: 1 } }])
      .mockResolvedValueOnce([])
    dbMock.agent.count.mockResolvedValue(1)
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbMock.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const req = new Request("http://localhost/api/projects/proj_1/workspace-report?format=markdown")
    const res = await workspaceReportGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Workspace Report - Alpha")
  })
})
