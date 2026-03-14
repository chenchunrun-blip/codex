import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/config", () => ({
  auth: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

jest.mock("@/lib/db", () => ({
  db: {
    file: {
      findUnique: jest.fn()
    }
  }
}))

jest.mock("@/lib/utils/export", () => ({
  exportToMarkdown: jest.fn(),
  exportToHTML: jest.fn()
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { GET: exportGet } = require("@/app/api/files/[id]/export/route")

describe("Files Export Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns invalid query code for unsupported format", async () => {
    dbMock.file.findUnique.mockResolvedValue({
      id: "file_1",
      project: { members: [{ userId: "user_1" }] }
    })

    const req = new Request("http://localhost/api/files/file_1/export?format=csv")
    const res = await exportGet(req, { params: Promise.resolve({ id: "file_1" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_QUERY_PARAMETERS")
  })
})
