type ApiErrorPayload = {
  code?: unknown
  error?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function mapReportApiError(code?: string, fallback?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Authentication required. Please sign in again."
    case "NOT_PROJECT_MEMBER":
      return "You are not a member of this project"
    case "INSUFFICIENT_PERMISSIONS":
      return "Insufficient permissions for this action"
    case "NO_PROJECT_MEMBERSHIP":
      return "No project membership found for this action"
    case "NO_EDITABLE_PROJECT":
      return "No editable project available for this action"
    case "PROJECT_NOT_FOUND":
    case "TARGET_PROJECT_NOT_FOUND":
      return "Target project not found in your accessible scope"
    case "SOURCE_PROJECT_NOT_FOUND":
      return "Source project not found in your accessible scope"
    case "TEAM_ACCESS_DENIED":
      return "You do not have access to this team"
    case "NOT_TEAM_MEMBER":
      return "You are not a member of this team"
    case "TEAM_NOT_FOUND":
      return "Team not found"
    case "TEAM_ADMIN_REQUIRED":
      return "Team admin role is required for this action"
    case "NO_TEAM_MEMBERSHIP":
      return "No team membership found for this action"
    case "TEAM_PROJECTS_NOT_FOUND":
      return "No available projects found for this team"
    case "TEAM_HAS_PROJECTS":
      return "Team still has projects and cannot be deleted"
    case "STARTER_PACK_NOT_FOUND":
      return "Starter pack not found"
    case "TEMPLATE_NOT_FOUND":
      return "Template not found"
    case "FILE_NOT_FOUND":
      return "File not found"
    case "FILE_TOO_LARGE":
      return "File is too large. Please upload a smaller file."
    case "UNSUPPORTED_FILE_TYPE":
      return "Unsupported file type. Use Markdown, TXT, or DOCX."
    case "COMMENT_NOT_FOUND":
      return "Comment not found"
    case "PARENT_COMMENT_NOT_FOUND":
      return "Parent comment not found"
    case "NOTIFICATION_NOT_FOUND":
      return "Notification not found"
    case "AGENT_NOT_FOUND":
      return "Agent not found"
    case "AGENT_NAME_CONFLICT":
      return "Agent name already exists"
    case "AGENT_HAS_ACTIVE_TASKS":
      return "Agent has active tasks and cannot be deleted"
    case "BUILTIN_TEMPLATE_READ_ONLY":
      return "Built-in templates are read-only"
    case "EMAIL_ALREADY_VERIFIED":
      return "Email is already verified"
    case "INVALID_VERIFICATION_TOKEN":
      return "Verification token is invalid"
    case "VERIFICATION_TOKEN_EXPIRED":
      return "Verification token has expired. Please request a new one."
    case "INVALID_REQUEST":
    case "INVALID_REQUEST_PAYLOAD":
    case "INVALID_QUERY_PARAMETERS":
    case "INVALID_JSON":
      return "Invalid request payload"
    case "INTERNAL_ERROR":
    case "OPERATIONS_STATUS_FAILED":
    case "OPERATIONS_STATUS_SAVE_FAILED":
    case "AGENT_QUEUE_STATUS_SAVE_FAILED":
    case "AGENT_WORKLOAD_REPORT_SAVE_FAILED":
    case "STARTER_PACK_APPLY_FAILED":
    case "STARTER_PACK_BULK_APPLY_FAILED":
    case "TEAM_STARTER_PACK_APPLY_FAILED":
    case "TEAM_TEMPLATE_ROLLOUT_FAILED":
    case "TEMPLATE_BULK_APPLY_FAILED":
    case "PROJECT_STARTER_HISTORY_SAVE_FAILED":
    case "PROJECT_STARTER_ROLLOUT_SUMMARY_SAVE_FAILED":
    case "TEAM_STARTER_HISTORY_SAVE_FAILED":
    case "TEAM_STARTER_ROLLOUT_SUMMARY_SAVE_FAILED":
    case "TEAM_WORKSPACE_REPORT_SAVE_FAILED":
    case "WORKSPACE_REPORT_FAILED":
    case "WORKSPACE_REPORT_SAVE_FAILED":
    case "FILE_TASKS_REPORT_FAILED":
    case "FILE_TASKS_REPORT_SAVE_FAILED":
    case "OPERATIONS_HEALTH_FAILED":
    case "BOTTLENECKS_REPORT_SAVE_FAILED":
    case "REMEDIATION_TASKS_CREATE_FAILED":
    case "LIVEBLOCKS_NOT_CONFIGURED":
      return "Service is temporarily unavailable. Please retry in a few seconds."
    default:
      return fallback || "Operation failed, please retry later"
  }
}

export function mapReportApiErrorFromPayload(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === "object" ? (payload as ApiErrorPayload) : {}
  const code = asString(record.code)
  const message = asString(record.error) || fallback
  return mapReportApiError(code, message)
}
