import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/auth/rbac", () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: "user_1", email: "u1@example.com" }
  }))
}))

const { POST: specLintPost } = require("@/app/api/tasks/spec-lint/route")

describe("Task Spec Lint Route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns lint result for valid markdown", async () => {
    const markdown = `# TaskSpec

## Goal
- Build robust assignment flow

## Deliverables
- API route and tests

## Requirements
- Keep backward compatibility

## Acceptance Criteria
- All tests pass

## Priority
- HIGH

## Due Date
- 2026-03-30`

    const req = new Request("http://localhost/api/tasks/spec-lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown })
    })

    const res = await specLintPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.valid).toBe(true)
    expect(typeof data.score).toBe("number")
    expect(Array.isArray(data.issues)).toBe(true)
  })

  it("returns issues for incomplete markdown", async () => {
    const req = new Request("http://localhost/api/tasks/spec-lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# TaskSpec\n\n## Goal\n- TBD"
      })
    })

    const res = await specLintPost(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.valid).toBe(false)
    expect(data.issues.some((issue: any) => issue.code === "MISSING_SECTION")).toBe(true)
  })

  it("returns 400 for invalid payload", async () => {
    const req = new Request("http://localhost/api/tasks/spec-lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })

    const res = await specLintPost(req)
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })
})
