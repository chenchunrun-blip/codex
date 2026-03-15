import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssigneeType, AssignmentMode, TaskStatus } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_actor", email: "actor@example.com" }
  }))
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
    projectMember: {
      findUnique: jest.fn()
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
    },
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { executeTaskWithAgent } = require("@/lib/agents/runtime")
const { POST: autoDispatchPost } = require("@/app/api/tasks/auto-dispatch/route")

describe("Task Auto Dispatch Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      body: "{invalid"
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("returns 400 for invalid request payload", async () => {
    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 0 })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })

  it("auto-dispatches AI_AUTO tasks and returns summary", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_201",
        title: "Build API",
        description: "Implement APIs",
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
    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", capabilities: ["engineering"] }
    ])
    dbMock.task.update.mockResolvedValue({})
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    executeTaskWithAgent.mockResolvedValue({
      output: "# Done",
      mode: "MODEL",
      targetAgent: "agent:agent_1"
    })
    dbMock.deliverable.create.mockResolvedValue({ id: "del_201" })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        limit: 5,
        autoSubmit: true
      })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.successCount).toBe(1)
    expect(data.failedCount).toBe(0)
    expect(data.results[0].status).toBe("SUCCESS")
    expect(executeTaskWithAgent).toHaveBeenCalledTimes(1)
  })

  it("records failed result when runtime execution fails", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "task_202",
        title: "Write tests",
        description: null,
        specMarkdown: "# TaskSpec",
        projectId: "proj_1",
        status: TaskStatus.PENDING,
        startedAt: null,
        assigneeType: AssigneeType.AGENT,
        assigneeId: null,
        agentId: "agent_1",
        functionalAgentType: null
      }
    ])
    dbMock.agent.findMany.mockResolvedValue([{ id: "agent_1", capabilities: [] }])
    dbMock.task.update.mockResolvedValue({})
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    executeTaskWithAgent.mockRejectedValue(new Error("runtime failed"))
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1"
      })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.successCount).toBe(0)
    expect(data.failedCount).toBe(1)
    expect(data.results[0].status).toBe("FAILED")
    expect(data.results[0].error).toContain("runtime failed")
  })

  it("deduplicates auto-dispatch by idempotencyKey", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T08:00:00.000Z"),
        metadata: {
          type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED",
          idempotencyKey: "dispatch-idem-1",
          projectId: "proj_1",
          total: 1,
          successCount: 1,
          failedCount: 0,
          results: [
            { taskId: "task_201", status: "SUCCESS", executionId: "exec_1", deliverableId: "del_1" }
          ]
        }
      }
    ])

    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        idempotencyKey: "dispatch-idem-1"
      })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.deduplicated).toBe(true)
    expect(dbMock.task.findMany).not.toHaveBeenCalled()
  })

  it("returns conflict when another batch started recently", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        metadata: {
          type: "AGENT_AUTO_DISPATCH_BATCH_STARTED"
        }
      }
    ])

    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1"
      })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe("AUTO_DISPATCH_CONFLICT")
  })

  it("fails dispatch when onlineOnly policy is enabled and no online agent is available", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_actor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany
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
        id: "task_203",
        title: "Queue task",
        description: null,
        specMarkdown: "# TaskSpec",
        projectId: "proj_1",
        status: TaskStatus.PENDING,
        startedAt: null,
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        assigneeId: null,
        agentId: null,
        functionalAgentType: "ENGINEERING"
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

    const req = new Request("http://localhost/api/tasks/auto-dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_1",
        limit: 1
      })
    })

    const res = await autoDispatchPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.failedCount).toBe(1)
    expect(data.results[0].status).toBe("FAILED")
    expect(data.results[0].error).toContain("No online agent available")
    expect(executeTaskWithAgent).not.toHaveBeenCalled()
  })
})
