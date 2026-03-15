import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    task: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    $transaction: jest.fn()
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: createRemediationPost } = require("@/app/api/projects/[id]/bottlenecks/remediation-tasks/route")

describe("Project Bottlenecks Remediation Tasks Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("creates remediation tasks from recommendations", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 2 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_1",
        title: "Fix API timeout",
        status: "IN_PROGRESS",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        specMarkdown: "# TaskSpec\n\n## Goal\n- TBD\n\n## Deliverables\n- TODO\n\n## Requirements\n- TBD\n\n## Acceptance Criteria\n- TODO\n\n## Priority\n- HIGH"
      }
    ])
    dbMock.activityLog.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.taskId?.in) {
        return [{ taskId: "task_1", createdAt: new Date(), metadata: { type: "AGENT_RUN_FAILED" } }]
      }
      return []
    })
    dbMock.$transaction.mockResolvedValue([
      {
        id: "rt_1",
        title: "[Remediation] Queue domain ENGINEERING has backlog 2 with no online agents",
        assignmentMode: "AI_AUTO",
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        createdAt: new Date()
      }
    ])
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks/remediation-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 3 })
    })
    const res = await createRemediationPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.total).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(data.created)).toBe(true)
    expect(data.created[0].assignmentMode).toBe("AI_AUTO")
    expect(data.created[0].assigneeType).toBe("FUNCTIONAL_AGENT")
    expect(dbMock.$transaction).toHaveBeenCalled()
    expect(data.dispatchPolicyUpdate?.changed).toBe(false)
  })

  it("auto-disables online-only dispatch when at-risk queues exist", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.task.groupBy.mockResolvedValue([
      { functionalAgentType: "ENGINEERING", _count: { _all: 2 } }
    ])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_1",
        title: "Fix API timeout",
        status: "IN_PROGRESS",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        specMarkdown: "# TaskSpec\n\n## Goal\n- TBD\n\n## Deliverables\n- TODO\n\n## Requirements\n- TBD\n\n## Acceptance Criteria\n- TODO\n\n## Priority\n- HIGH"
      }
    ])
    dbMock.activityLog.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.taskId?.in) {
        return [{ taskId: "task_1", createdAt: new Date(), metadata: { type: "AGENT_RUN_FAILED" } }]
      }
      return [
        {
          createdAt: new Date("2026-03-12T10:00:00.000Z"),
          metadata: {
            type: "PROJECT_DISPATCH_POLICY_UPDATED",
            onlineOnly: true
          }
        }
      ]
    })
    dbMock.$transaction.mockResolvedValue([
      {
        id: "rt_2",
        title: "[Remediation] Queue domain ENGINEERING has backlog 2 with no online agents",
        assignmentMode: "AI_AUTO",
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        createdAt: new Date()
      }
    ])
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks/remediation-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 3, applyDispatchFallback: true })
    })
    const res = await createRemediationPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.dispatchPolicyUpdate?.changed).toBe(true)
    expect(data.dispatchPolicyUpdate?.onlineOnly).toBe(false)
    expect(dbMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TASK_UPDATED",
          metadata: expect.objectContaining({
            type: "PROJECT_DISPATCH_POLICY_UPDATED",
            onlineOnly: false,
            triggeredBy: "BOTTLENECKS_REMEDIATION"
          })
        })
      })
    )
  })

  it("rejects viewer role", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/projects/proj_1/bottlenecks/remediation-tasks", {
      method: "POST"
    })
    const res = await createRemediationPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
