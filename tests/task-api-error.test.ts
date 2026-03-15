import { describe, expect, it } from "@jest/globals"
import {
  mapTaskApiError,
  mapTaskApiErrorFromPayload,
  mapTaskOpsApiError,
  mapTaskOpsApiErrorFromPayload
} from "@/lib/tasks/api-error"

describe("task api error mapping", () => {
  it("maps task domain error codes", () => {
    expect(mapTaskApiError("TASK_NOT_FOUND")).toBe("Task not found")
    expect(mapTaskApiError("INVALID_REQUEST")).toBe("Invalid request payload")
    expect(mapTaskApiError("AGENT_RUN_CONFLICT")).toContain("Another agent run is active")
    expect(mapTaskApiError("UNAUTHORIZED")).toContain("Authentication required")
  })

  it("maps task payload error to user message", () => {
    const payload = { code: "NOT_PROJECT_MEMBER", error: "Not a project member" }
    expect(mapTaskApiErrorFromPayload(payload, "fallback")).toBe("You are not a member of this project")
  })

  it("maps task operations payload error to user message", () => {
    const payload = { code: "AUTO_DISPATCH_CONFLICT", error: "Another auto-dispatch batch is running" }
    expect(mapTaskOpsApiErrorFromPayload(payload, "fallback")).toContain("dispatch batch is running")
  })

  it("maps task operations internal error to recoverable message", () => {
    const payload = { code: "INTERNAL_ERROR", error: "Failed to fetch metrics" }
    expect(mapTaskOpsApiErrorFromPayload(payload, "fallback")).toContain("temporarily unavailable")
  })

  it("maps operations status failure to recoverable message", () => {
    expect(mapTaskOpsApiError("OPERATIONS_STATUS_FAILED")).toContain("temporarily unavailable")
  })

  it("falls back when payload is malformed", () => {
    expect(mapTaskOpsApiErrorFromPayload(null, "fallback")).toBe("fallback")
    expect(mapTaskApiErrorFromPayload({ error: 123 }, "fallback")).toBe("fallback")
  })
})
