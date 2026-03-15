import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { AssigneeType } from "@prisma/client"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_reviewer", email: "reviewer@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    deliverable: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    task: {
      update: jest.fn()
    },
    taskAssignmentLog: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    },
    notification: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: reviewPost } = require("@/app/api/deliverables/[id]/review/route")

describe("Deliverable Review Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("re-queues agent task when deliverable is rejected", async () => {
    dbMock.deliverable.findUnique.mockResolvedValue({
      id: "del_1",
      name: "Deliverable 1",
      taskId: "task_1",
      task: {
        id: "task_1",
        title: "Task 1",
        projectId: "proj_1",
        project: {},
        assignmentLogs: [
          {
            action: "ASSIGNED",
            fromType: null,
            fromAssigneeId: null,
            fromAgentId: null,
            toType: AssigneeType.AGENT,
            toAssigneeId: null,
            toAgentId: "agent_1"
          }
        ],
        assignee: null,
        agent: {
          id: "agent_1",
          name: "eng-agent",
          displayName: "Engineering Agent",
          capabilities: ["engineering"]
        },
        status: "IN_PROGRESS",
        assigneeType: AssigneeType.AGENT,
        assigneeId: null,
        agentId: "agent_1",
        functionalAgentType: null,
        claimedAt: new Date("2026-03-12T00:00:00.000Z"),
        specMarkdown: "# TaskSpec"
      }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_reviewer",
      role: "EDITOR"
    })
    dbMock.deliverable.update.mockResolvedValue({
      id: "del_1",
      status: "REJECTED",
      task: { id: "task_1", title: "Task 1", projectId: "proj_1" },
      file: null
    })
    dbMock.task.update.mockResolvedValue({})
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/deliverables/del_1/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "REJECTED",
        feedback: "Please add test evidence"
      })
    })

    const res = await reviewPost(req, { params: Promise.resolve({ id: "del_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.requeue.requeued).toBe(true)
    expect(data.requeue.queueDomain).toBe("ENGINEERING")
    expect(dbMock.task.update).toHaveBeenCalled()
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it("does not re-queue when deliverable is approved", async () => {
    dbMock.deliverable.findUnique.mockResolvedValue({
      id: "del_2",
      name: "Deliverable 2",
      taskId: "task_2",
      task: {
        id: "task_2",
        title: "Task 2",
        projectId: "proj_1",
        project: {},
        assignmentLogs: [],
        assignee: null,
        agent: null,
        status: "REVIEW",
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        assigneeId: null,
        agentId: null,
        functionalAgentType: "QA",
        claimedAt: null,
        specMarkdown: "# TaskSpec"
      }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_reviewer",
      role: "EDITOR"
    })
    dbMock.deliverable.update.mockResolvedValue({
      id: "del_2",
      status: "APPROVED",
      task: { id: "task_2", title: "Task 2", projectId: "proj_1" },
      file: null
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/deliverables/del_2/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "APPROVED"
      })
    })

    const res = await reviewPost(req, { params: Promise.resolve({ id: "del_2" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.requeue.requeued).toBe(false)
    expect(dbMock.task.update).not.toHaveBeenCalled()
  })

  it("returns 400 when rejection feedback is missing", async () => {
    dbMock.deliverable.findUnique.mockResolvedValue({
      id: "del_3",
      name: "Deliverable 3",
      taskId: "task_3",
      task: {
        id: "task_3",
        title: "Task 3",
        projectId: "proj_1",
        project: {},
        assignmentLogs: [],
        assignee: null,
        agent: null,
        status: "REVIEW",
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        assigneeId: null,
        agentId: null,
        functionalAgentType: "ENGINEERING",
        claimedAt: null,
        specMarkdown: "# TaskSpec"
      }
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_reviewer",
      role: "EDITOR"
    })

    const req = new Request("http://localhost/api/deliverables/del_3/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "REJECTED"
      })
    })

    const res = await reviewPost(req, { params: Promise.resolve({ id: "del_3" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REVIEW_PAYLOAD")
  })

  it("returns 400 when review payload is invalid json", async () => {
    const req = new Request("http://localhost/api/deliverables/del_3/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid json}"
    })

    const res = await reviewPost(req, { params: Promise.resolve({ id: "del_3" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REVIEW_PAYLOAD")
    expect(dbMock.deliverable.findUnique).not.toHaveBeenCalled()
  })

  it("returns structured code when deliverable does not exist", async () => {
    dbMock.deliverable.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/deliverables/missing/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "APPROVED"
      })
    })

    const res = await reviewPost(req, { params: Promise.resolve({ id: "missing" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("DELIVERABLE_NOT_FOUND")
  })
})
