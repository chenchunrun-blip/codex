import { describe, expect, it } from "@jest/globals"
import { mapReportApiError, mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

describe("report api error mapping", () => {
  it("maps common authorization and membership errors", () => {
    expect(mapReportApiError("UNAUTHORIZED")).toContain("Authentication required")
    expect(mapReportApiError("NOT_PROJECT_MEMBER")).toContain("not a member")
  })

  it("maps invalid request and service errors", () => {
    expect(mapReportApiError("INVALID_REQUEST_PAYLOAD")).toBe("Invalid request payload")
    expect(mapReportApiError("OPERATIONS_STATUS_SAVE_FAILED")).toContain("temporarily unavailable")
  })

  it("maps starter-pack and team scoped errors", () => {
    expect(mapReportApiError("TEAM_ADMIN_REQUIRED")).toContain("admin role")
    expect(mapReportApiError("STARTER_PACK_NOT_FOUND")).toContain("Starter pack not found")
    expect(mapReportApiError("PROJECT_STARTER_HISTORY_SAVE_FAILED")).toContain("temporarily unavailable")
    expect(mapReportApiError("NOT_TEAM_MEMBER")).toContain("not a member")
    expect(mapReportApiError("TEAM_WORKSPACE_REPORT_SAVE_FAILED")).toContain("temporarily unavailable")
    expect(mapReportApiError("WORKSPACE_REPORT_SAVE_FAILED")).toContain("temporarily unavailable")
    expect(mapReportApiError("FILE_NOT_FOUND")).toContain("File not found")
    expect(mapReportApiError("FILE_TOO_LARGE")).toContain("too large")
    expect(mapReportApiError("UNSUPPORTED_FILE_TYPE")).toContain("Unsupported file type")
    expect(mapReportApiError("OPERATIONS_HEALTH_FAILED")).toContain("temporarily unavailable")
    expect(mapReportApiError("REMEDIATION_TASKS_CREATE_FAILED")).toContain("temporarily unavailable")
    expect(mapReportApiError("AGENT_NOT_FOUND")).toContain("Agent not found")
  })

  it("maps payload with code using fallback message", () => {
    const payload = { code: "TARGET_PROJECT_NOT_FOUND", error: "target missing" }
    expect(mapReportApiErrorFromPayload(payload, "fallback")).toContain("Target project not found")
  })

  it("falls back when payload is malformed", () => {
    expect(mapReportApiErrorFromPayload(null, "fallback")).toBe("fallback")
  })
})
