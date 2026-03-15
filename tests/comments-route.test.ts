import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com", name: "User One" }
  })),
  requireProjectAccess: jest.fn(async () => ({ membership: { role: "EDITOR" } }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findUnique: jest.fn()
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    user: {
      findMany: jest.fn()
    },
    notification: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

jest.mock("@/lib/email/send-notification", () => ({
  sendMentionEmail: jest.fn(async () => undefined)
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { POST: commentsPost, GET: commentsGet } = require("@/app/api/comments/route")

describe("Comments Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid payload code on malformed create payload", async () => {
    const req = new Request("http://localhost/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: "", content: "" })
    })

    const res = await commentsPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.comment.create).not.toHaveBeenCalled()
  })

  it("returns invalid query code when fileId is missing", async () => {
    const req = new Request("http://localhost/api/comments")

    const res = await commentsGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
    expect(dbMock.comment.findMany).not.toHaveBeenCalled()
  })
})
