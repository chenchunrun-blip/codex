import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssigneeType, AssignmentMode, TaskStatus } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/utils/encryption", () => ({
  decrypt: jest.fn(() => "agent_secret"),
  secureCompare: jest.fn(() => true)
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn()
    },
    project: {
      findUnique: jest.fn()
    },
    template: {
      findMany: jest.fn()
    },
    file: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn()
    },
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn()
    },
    agent: {
      findUnique: jest.fn(),
      update: jest.fn()
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
const { POST: applyPackPost } = require("@/app/api/projects/[id]/starter-files/apply-pack/route")
const { POST: createTaskFromFilePost } = require("@/app/api/files/[id]/tasks/route")
const { POST: pullPost } = require("@/app/api/tasks/agent-queue/pull/route")

function buildAgentHeaders() {
  return {
    "Content-Type": "application/json",
    "x-agent-id": "agent_1",
    Authorization: "Bearer agent_secret"
  }
}

describe("Human-Agent Collaboration Flow Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("covers starter pack -> task from file -> agent queue claim flow", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha",
      creatorId: "user_owner"
    })
    dbMock.template.findMany.mockResolvedValue([
      { id: "t1", name: "Project Charter (PM)", category: "PROBLEM_DEFINITION", content: "# charter" }
    ])
    dbMock.file.findMany.mockResolvedValue([])
    dbMock.file.create.mockResolvedValue({ id: "file_1" })
    dbMock.activityLog.create.mockResolvedValue({})

    const applyReq = new Request("http://localhost/api/projects/proj_1/starter-files/apply-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: "PM_STARTER" })
    })
    const applyRes = await applyPackPost(applyReq, { params: Promise.resolve({ id: "proj_1" }) })
    const applyData = await applyRes.json()
    expect(applyRes.status).toBe(200)
    expect(applyData.createdCount).toBeGreaterThanOrEqual(1)

    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      name: "Project-Charter.md",
      content: "# TaskSpec\n\n## Goal\n- Build queue flow",
      projectId: "proj_1"
    })
    dbMock.task.create.mockResolvedValue({
      id: "task_1",
      title: "Implement queue flow",
      projectId: "proj_1"
    })

    const createTaskReq = new Request("http://localhost/api/files/file_1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Implement queue flow",
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING"
      })
    })
    const createTaskRes = await createTaskFromFilePost(createTaskReq, {
      params: Promise.resolve({ id: "file_1" })
    })
    const createTaskData = await createTaskRes.json()
    expect(createTaskRes.status).toBe(201)
    expect(createTaskData.task.id).toBe("task_1")

    dbMock.agent.findUnique.mockResolvedValue({
      id: "agent_1",
      name: "eng-agent",
      displayName: "Engineering Agent",
      isActive: true,
      apiKeyEncrypted: "enc_key"
    })
    dbMock.task.findFirst.mockResolvedValue({
      id: "task_1",
      title: "Implement queue flow",
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
      id: "task_1",
      title: "Implement queue flow",
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
      claimedAt: new Date("2026-03-13T08:00:00.000Z"),
      startedAt: new Date("2026-03-13T08:00:00.000Z")
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.projectMember.findFirst.mockResolvedValue({
      userId: "user_editor",
      role: "EDITOR"
    })

    const pullReq = new Request("http://localhost/api/tasks/agent-queue/pull", {
      method: "POST",
      headers: buildAgentHeaders(),
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: true
      })
    })
    const pullRes = await pullPost(pullReq)
    const pullData = await pullRes.json()

    expect(pullRes.status).toBe(200)
    expect(pullData.claimed).toBe(true)
    expect(pullData.task.id).toBe("task_1")
    expect(dbMock.task.updateMany).toHaveBeenCalled()
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })
})
