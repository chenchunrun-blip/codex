import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findMany: jest.fn()
    },
    task: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: tasksReportGet } = require("@/app/api/tasks/report/route")

describe("Tasks Report Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns json report payload", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Implement API",
        status: "IN_PROGRESS",
        priority: 2,
        dueDate: null,
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/tasks/report?sourceProjectId=p1")
    const res = await tasksReportGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.assigneeCounts.AGENT_QUEUE).toBe(1)
    expect(data.tasks[0].assigneeType).toBe("AGENT_QUEUE")
  })

  it("returns markdown when format=markdown", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])
    dbMock.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Implement API",
        status: "IN_PROGRESS",
        priority: 2,
        dueDate: null,
        assigneeType: "FUNCTIONAL_AGENT",
        functionalAgentType: "ENGINEERING",
        project: { id: "p1", name: "Alpha" }
      }
    ])

    const req = new Request("http://localhost/api/tasks/report?sourceProjectId=p1&format=markdown")
    const res = await tasksReportGet(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(text).toContain("# Tasks Report")
    expect(text).toContain("AGENT_QUEUE")
  })

  it("returns 403 for inaccessible source project", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1" }])

    const req = new Request("http://localhost/api/tasks/report?sourceProjectId=p2")
    const res = await tasksReportGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })
})
