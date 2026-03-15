import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("next/headers", () => ({
  headers: jest.fn()
}))

jest.mock("@/lib/db", () => ({
  db: {
    agent: {
      findMany: jest.fn(),
      findUnique: jest.fn()
    }
  }
}))

jest.mock("@/lib/utils/encryption", () => ({
  decrypt: jest.fn(),
  secureCompare: jest.fn()
}))

const { headers } = require("next/headers")
const headersMock = headers as jest.Mock
const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { decrypt, secureCompare } = require("@/lib/utils/encryption")
const decryptMock = decrypt as jest.Mock
const secureCompareMock = secureCompare as jest.Mock

const { POST: mcpPost } = require("@/app/api/mcp/route")

describe("MCP Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns structured unauthorized code when API key is missing", async () => {
    headersMock.mockReturnValue(new Headers())

    const req = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "initialize" })
    })

    const res = await mcpPost(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error?.data?.code).toBe("UNAUTHORIZED")
  })

  it("returns structured invalid payload code when JSON parse fails", async () => {
    const apiKey = "valid_api_key_1234567890"
    const hdrs = new Headers()
    hdrs.set("X-API-Key", apiKey)
    headersMock.mockReturnValue(hdrs)

    dbMock.agent.findMany.mockResolvedValue([
      { id: "agent_1", apiKeyEncrypted: "enc_key", name: "agent" }
    ])
    decryptMock.mockReturnValue(apiKey)
    secureCompareMock.mockReturnValue(true)

    const req = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid json}"
    })

    const res = await mcpPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error?.data?.code).toBe("INVALID_REQUEST_PAYLOAD")
  })
})
