import { beforeEach, describe, expect, it, jest } from "@jest/globals"

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
    activityLog: {
      findMany: jest.fn(),
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const {
  GET: dispatchPolicyGet,
  PATCH: dispatchPolicyPatch
} = require("@/app/api/projects/[id]/dispatch-policy/route")

describe("Project Dispatch Policy Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("gets project dispatch policy for member", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-03-12T10:00:00.000Z"),
        metadata: {
          type: "PROJECT_DISPATCH_POLICY_UPDATED",
          onlineOnly: true
        }
      }
    ])

    const req = new Request("http://localhost/api/projects/proj_1/dispatch-policy")
    const res = await dispatchPolicyGet(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.onlineOnly).toBe(true)
    expect(data.source).toBe("project")
  })

  it("updates policy for editor", async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: "proj_1",
      userId: "user_editor",
      role: "EDITOR"
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request("http://localhost/api/projects/proj_1/dispatch-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        onlineOnly: true
      })
    })
    const res = await dispatchPolicyPatch(req, { params: Promise.resolve({ id: "proj_1" }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.onlineOnly).toBe(true)
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })
})

