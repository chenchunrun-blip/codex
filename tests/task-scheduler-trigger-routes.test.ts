import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssignmentMode, AssigneeType, TaskStatus } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn()
}))

jest.mock("@/lib/agents/runtime", () => ({
  executeTaskWithAgent: jest.fn(),
  AgentRuntimeError: class AgentRuntimeError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 500) {
      super(message)
      this.code = code
      this.status = status
    }
  }
}))

jest.mock("@/lib/db", () => ({
  db: {
    project: {
      findUnique: jest.fn()
    },
    projectMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    task: {
      findMany: jest.fn(),
      update: jest.fn()
    },
    agent: {
      findMany: jest.fn()
    },
    deliverable: {
      create: jest.fn()
    }
  }
}))

const { requireAuthApi } = require("@/lib/auth/rbac")
const { executeTaskWithAgent } = require("@/lib/agents/runtime")
const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: schedulerPost } = require("@/app/api/tasks/scheduler/trigger/route")

describe("Task Scheduler Trigger Route", () => {
  const originalToken = process.env.TASK_SCHEDULER_TOKEN

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TASK_SCHEDULER_TOKEN = "sched_secret"
  })

  afterAll(() => {
    process.env.TASK_SCHEDULER_TOKEN = originalToken
  })

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      body: "{invalid"
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("returns 400 for invalid request payload", async () => {
    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: 0
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST")
  })

  it("triggers scheduled dispatch with token when no session", async () => {
    requireAuthApi.mockResolvedValue(null)
    dbMock.project.findUnique.mockResolvedValue({ creatorId: "user_system" })
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_301",
        title: "Task 301",
        description: null,
        specMarkdown: "# TaskSpec",
        projectId: "proj_1",
        status: TaskStatus.PENDING,
        startedAt: null,
        assigneeType: AssigneeType.AGENT,
        assigneeId: null,
        agentId: "agent_1",
        functionalAgentType: null,
        assignmentMode: AssignmentMode.AI_AUTO
      }
    ])
    dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", capabilities: ["engineering"] }])
    dbMock.task.update.mockResolvedValue({})
    executeTaskWithAgent.mockResolvedValue({
      output: "# done",
      mode: "MODEL",
      targetAgent: "agent:agent_1"
    })
    dbMock.deliverable.create.mockResolvedValue({ id: "del_301" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scheduler-token": "sched_secret"
      },
      body: JSON.stringify({
        projectId: "proj_1",
        limit: 1
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.triggerMode).toBe("SCHEDULED")
    expect(data.total).toBe(1)
  })

  it("rejects when neither session nor valid scheduler token", async () => {
    requireAuthApi.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1"
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.code).toBe("UNAUTHORIZED")
  })

  it("triggers manual dispatch for authenticated editor", async () => {
    requireAuthApi.mockResolvedValue({
      user: { id: "user_editor", email: "editor@example.com" }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([]) // scheduler config resolver
      .mockResolvedValueOnce([]) // recent batch logs
    dbMock.task.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        limit: 1
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.triggerMode).toBe("MANUAL")
    expect(data.total).toBe(0)
  })

  it("rejects scheduler trigger when project scheduler is disabled", async () => {
    requireAuthApi.mockResolvedValue({
      user: { id: "user_editor", email: "editor@example.com" }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_SCHEDULER_CONFIG_UPDATED",
          enabled: false,
          defaultLimit: 5,
          defaultAutoSubmit: true
        }
      }
    ])

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1"
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("SCHEDULER_DISABLED")
  })

  it("filters dispatch scope by taskIds when provided", async () => {
    requireAuthApi.mockResolvedValue({
      user: { id: "user_editor", email: "editor@example.com" }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.task.findMany.mockResolvedValue([])
    dbMock.agent.findMany.mockResolvedValue([])
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        taskIds: ["task_1", "task_2"],
        limit: 2
      })
    })

    const res = await schedulerPost(req)
    await res.json()

    expect(res.status).toBe(200)
    expect(dbMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["task_1", "task_2"] }
        })
      })
    )
  })

  it("fails scheduler dispatch when onlineOnly policy is enabled and no online agent is available", async () => {
    requireAuthApi.mockResolvedValue({
      user: { id: "user_editor", email: "editor@example.com" }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([]) // scheduler config
      .mockResolvedValueOnce([
        {
          createdAt: new Date("2026-03-12T09:00:00.000Z"),
          metadata: {
            type: "PROJECT_DISPATCH_POLICY_UPDATED",
            onlineOnly: true
          }
        }
      ])
      .mockResolvedValueOnce([])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_302",
        title: "Queue task",
        description: null,
        specMarkdown: "# TaskSpec",
        projectId: "proj_1",
        status: TaskStatus.PENDING,
        startedAt: null,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        assigneeId: null,
        agentId: null,
        functionalAgentType: "ENGINEERING",
        assignmentMode: AssignmentMode.AI_AUTO
      }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_1",
        capabilities: ["engineering"],
        updatedAt: new Date(Date.now() - 10 * 60 * 1000)
      }
    ])
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/scheduler/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        limit: 1
      })
    })

    const res = await schedulerPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.failedCount).toBe(1)
    expect(data.results[0].status).toBe("FAILED")
    expect(data.results[0].error).toContain("No online agent available")
    expect(executeTaskWithAgent).not.toHaveBeenCalled()
  })
})
