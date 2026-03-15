import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssigneeType, AssignmentMode, TaskStatus } from "@prisma/client"

jest.mock("@/lib/utils/encryption", () => ({
  decrypt: jest.fn(() => "agent_secret"),
  secureCompare: jest.fn(() => true)
}))

jest.mock("@/lib/db", () => ({
  db: {
    project: {
      findUnique: jest.fn()
    },
    projectMember: {
      findFirst: jest.fn()
    },
    agent: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    task: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    },
    taskAssignmentLog: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: pullPost } = require("@/app/api/tasks/agent-queue/pull/route")

function buildAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "x-agent-id": "agent_1",
    Authorization: "Bearer agent_secret"
  }
}

describe("Task Agent Queue Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 400 for invalid JSON payload", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: "{invalid"
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("pulls and claims next queue task for agent", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.task.findFirst.mockResolvedValue({
      id: "task_101",
      title: "Implement queue worker",
      description: "Build worker",
      priority: 3,
      status: TaskStatus.PENDING,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.MANUAL
    })
    dbMock.project.findUnique.mockResolvedValue({ creatorId: "user_creator" })
    dbMock.agent.update.mockResolvedValue({})
    dbMock.task.updateMany.mockResolvedValue({ count: 1 })
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_101",
      title: "Implement queue worker",
      description: "Build worker",
      priority: 3,
      status: TaskStatus.IN_PROGRESS,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: "agent_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.AI_AUTO,
      claimedAt: new Date("2026-03-12T08:00:00.000Z"),
      startedAt: new Date("2026-03-12T08:00:00.000Z")
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: true
      })
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.claimed).toBe(true)
    expect(data.task.id).toBe("task_101")
    expect(data.task.assigneeType).toBe(AssigneeType.AGENT)
    expect(dbMock.task.updateMany).toHaveBeenCalled()
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("supports peek-only pull without claim", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.task.findFirst.mockResolvedValue({
      id: "task_102",
      title: "Prepare test plan",
      description: null,
      priority: 2,
      status: TaskStatus.PENDING,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.AI_SUGGESTED
    })
    dbMock.agent.update.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: false
      })
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.claimed).toBe(false)
    expect(data.task.id).toBe("task_102")
    expect(dbMock.task.updateMany).not.toHaveBeenCalled()
  })

  it("returns empty task when queue has no matching task", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.task.findFirst.mockResolvedValue(null)
    dbMock.agent.update.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING"
      })
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.claimed).toBe(false)
    expect(data.task).toBeNull()
  })

  it("returns error when no project actor can be resolved", async () => {
    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.task.findFirst.mockResolvedValue({
      id: "task_103",
      title: "Queue task",
      description: null,
      priority: 2,
      status: TaskStatus.PENDING,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.MANUAL
    })
    dbMock.agent.update.mockResolvedValue({})
    dbMock.task.updateMany.mockResolvedValue({ count: 1 })
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_103",
      title: "Queue task",
      description: null,
      priority: 2,
      status: TaskStatus.IN_PROGRESS,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: "agent_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.AI_AUTO,
      claimedAt: new Date("2026-03-12T08:00:00.000Z"),
      startedAt: new Date("2026-03-12T08:00:00.000Z")
    })
    dbMock.project.findUnique.mockResolvedValue(null)
    dbMock.projectMember.findFirst.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: true
      })
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.code).toBe("PROJECT_ACTOR_NOT_FOUND")
  })

  it("rejects invalid agent credentials", async () => {
    dbMock.agent.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING"
      })
    })

    const res = await pullPost(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.code).toBe("AGENT_AUTH_INVALID")
  })
})
