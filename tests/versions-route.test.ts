import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  })),
  requireProjectAccess: jest.fn(async () => ({ membership: { role: "EDITOR" } }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findUnique: jest.fn()
    },
    fileVersion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: versionsGet, POST: versionsPost } = require("@/app/api/versions/route")

describe("Versions Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid payload code for malformed version payload", async () => {
    const req = new Request("http://localhost/api/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: "", content: 1 })
    })

    const res = await versionsPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
    expect(dbMock.fileVersion.create).not.toHaveBeenCalled()
  })

  it("returns invalid query code when fileId is missing", async () => {
    const req = new Request("http://localhost/api/versions")

    const res = await versionsGet(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
    expect(dbMock.fileVersion.findMany).not.toHaveBeenCalled()
  })

  it("returns file not found code when file is missing", async () => {
    dbMock.file.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/versions?fileId=file_missing")
    const res = await versionsGet(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("FILE_NOT_FOUND")
  })
})
