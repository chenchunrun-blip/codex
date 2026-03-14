import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssigneeType, AssignmentMode, TaskStatus } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_editor", email: "editor@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    agent: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    },
    task: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn()
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
const { POST: manualPullPost } = require("@/app/api/tasks/agent-queue/manual-pull/route")

describe("Task Agent Queue Manual Pull Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 400 for invalid JSON payload", async () => {
    const req = new Request("http://localhost/api/tasks/agent-queue/manual-pull", {
      method: "POST",
      body: "{invalid"
    })
    const res = await manualPullPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("returns 400 for invalid request payload", async () => {
    const req = new Request("http://localhost/api/tasks/agent-queue/manual-pull", {
      method: "POST",
      body: JSON.stringify({
        projectId: "proj_1"
      })
    })
    const res = await manualPullPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST")
  })

  it("returns 403 when current user is not a project member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/agent-queue/manual-pull", {
      method: "POST",
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: true
      })
    })
    const res = await manualPullPost(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("claims next queue task with auto-selected active agent", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: "agent_eng_1",
        capabilities: ["engineering"],
        updatedAt: new Date()
      }
    ])
    dbMock.agent.update.mockResolvedValue({})
    dbMock.task.findFirst.mockResolvedValue({
      id: "task_201",
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
    dbMock.task.updateMany.mockResolvedValue({ count: 1 })
    dbMock.task.findUnique.mockResolvedValue({
      id: "task_201",
      title: "Implement queue worker",
      description: "Build worker",
      priority: 3,
      status: TaskStatus.IN_PROGRESS,
      dueDate: null,
      specMarkdown: "# TaskSpec",
      projectId: "proj_1",
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: "agent_eng_1",
      functionalAgentType: "ENGINEERING",
      assignmentMode: AssignmentMode.AI_AUTO,
      claimedAt: new Date("2026-03-12T08:00:00.000Z"),
      startedAt: new Date("2026-03-12T08:00:00.000Z")
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/tasks/agent-queue/manual-pull", {
      method: "POST",
      body: JSON.stringify({
        projectId: "proj_1",
        functionalAgentType: "ENGINEERING",
        claim: true
      })
    })
    const res = await manualPullPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.claimed).toBe(true)
    expect(data.agentId).toBe("agent_eng_1")
    expect(data.task.id).toBe("task_201")
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })
})
