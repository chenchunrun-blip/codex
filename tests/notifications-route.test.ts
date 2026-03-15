import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: notificationsGet } = require("@/app/api/notifications/route")
const { POST: notificationReadPost } = require("@/app/api/notifications/[id]/read/route")

describe("Notifications Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid query code for bad limit", async () => {
    const req = new Request("http://localhost/api/notifications?limit=0")
    const res = await notificationsGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
    expect(dbMock.notification.findMany).not.toHaveBeenCalled()
  })

  it("returns notification not found code", async () => {
    dbMock.notification.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/notifications/n1/read", {
      method: "POST"
    })
    const res = await notificationReadPost(req, { params: Promise.resolve({ id: "n1" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("NOTIFICATION_NOT_FOUND")
  })
})
