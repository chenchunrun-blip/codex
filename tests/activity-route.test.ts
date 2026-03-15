import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    projectMember: {
      findMany: jest.fn()
    },
    file: {
      findUnique: jest.fn()
    },
    activityLog: {
      findMany: jest.fn(),
      count: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: activityGet } = require("@/app/api/activity/route")

describe("Activity Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid query code for bad limit", async () => {
    const req = new Request("http://localhost/api/activity?limit=0")
    const res = await activityGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
  })

  it("returns not project member code when project is out of scope", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([{ projectId: "proj_1" }])

    const req = new Request("http://localhost/api/activity?projectId=proj_2")
    const res = await activityGet(req)
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it("returns empty result when user has no memberships", async () => {
    dbMock.projectMember.findMany.mockResolvedValue([])

    const req = new Request("http://localhost/api/activity")
    const res = await activityGet(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.activities).toEqual([])
    expect(data.count).toBe(0)
    expect(data.hasMore).toBe(false)
    expect(dbMock.activityLog.findMany).not.toHaveBeenCalled()
  })
})
