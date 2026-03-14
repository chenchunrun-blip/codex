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
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: bottlenecksGet } = require("@/app/api/projects/[id]/bottlenecks/route")

describe("Project Bottlenecks Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns at-risk domains and high-risk tasks", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 3 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        capabilities: ["qa"],
        updatedAt: new Date()
      }
    ])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_1",
        title: "Fix API timeout",
        status: "IN_PROGRESS",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        specMarkdown: `# TaskSpec

## Goal
- TBD

## Deliverables
- TODO

## Requirements
- TBD

## Acceptance Criteria
- TODO

## Priority
- HIGH`
      }
    ])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        taskId: "task_1",
        createdAt: new Date(),
        metadata: { type: "AGENT_RUN_FAILED" }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks")
    const res = await bottlenecksGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.atRiskDomains)).toBe(true)
    expect(data.atRiskDomains[0].domain).toBe("ENGINEERING")
    expect(Array.isArray(data.highRiskTasks)).toBe(true)
    expect(data.highRiskTasks[0].id).toBe("task_1")
    expect(data.highRiskTasks[0].riskLevel).toBe("HIGH")
    expect(Array.isArray(data.recommendations)).toBe(true)
    expect(data.recommendations.length).toBeGreaterThan(0)
  })

  it("returns 403 for non-member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks")
    const res = await bottlenecksGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("supports markdown export format", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_1",
      role: "VIEWER"
    })
    dbMock.task.groupBy.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.task.findMany.mockResolvedValue([])
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks?format=markdown")
    const res = await bottlenecksGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("Project Bottlenecks Report")
    expect(text).toContain("Recommendations")
  })
})
