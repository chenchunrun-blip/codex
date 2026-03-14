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
      findMany: jest.fn(),
      create: jest.fn()
    },
    file: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: saveWorkspaceReportPost } = require("@/app/api/projects/[id]/workspace-report/save/route")

describe("Workspace Report Save Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("saves workspace markdown report as project file", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.project.findUnique.mockResolvedValue({
      id: "proj_1",
      name: "Alpha",
      status: "ACTIVE",
      team: { name: "Core Team" },
      _count: { files: 3, members: 5 }
    })
    dbMock.task.groupBy
      .mockResolvedValueOnce([{ status: "PENDING", _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ functionalAgentType: "ENGINEERING", _count: { _all: 1 } }])
    dbMock.agent.count.mockResolvedValue(4)
    dbMock.activityLog.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date("2026-03-12T12:00:00.000Z"),
          metadata: {
            type: "AGENT_AUTO_DISPATCH_BATCH_COMPLETED",
            successCount: 1,
            failedCount: 0,
            triggerMode: "MANUAL"
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          taskId: "task_1",
          createdAt: new Date("2026-03-12T12:05:00.000Z"),
          metadata: {
            type: "AGENT_RUN_TRIGGERED",
            runtimeMode: "ENDPOINT"
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
    dbMock.file.create.mockResolvedValue({
      id: "file_report_1",
      name: "workspace-report-xxx.md",
      createdAt: new Date("2026-03-12T12:01:00.000Z")
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/workspace-report/save", {
      method: "POST"
    })
    const res = await saveWorkspaceReportPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.file.id).toBe("file_report_1")
    expect(dbMock.file.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it("rejects viewer role", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "VIEWER"
    })

    const req = new Request("http://localhost/api/projects/proj_1/workspace-report/save", {
      method: "POST"
    })
    const res = await saveWorkspaceReportPost(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("INSUFFICIENT_PERMISSIONS")
  })
})
