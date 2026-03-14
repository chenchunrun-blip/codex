type ApiErrorPayload = {
  code?: unknown
  error?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function mapTaskApiError(code?: string, fallback?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Authentication required. Please sign in again."
    case "TASK_NOT_FOUND":
      return "Task not found"
    case "NOT_PROJECT_MEMBER":
      return "You are not a member of this project"
    case "INSUFFICIENT_PERMISSIONS":
      return "Insufficient permissions for this action"
    case "INVALID_REQUEST_PAYLOAD":
    case "INVALID_ASSIGNMENT_PAYLOAD":
    case "INVALID_CLAIM_PAYLOAD":
    case "INVALID_REQUEST":
    case "INVALID_JSON":
      return "Invalid request payload"
    case "AGENT_OFFLINE_BY_POLICY":
      return "Selected agent is offline under project dispatch policy"
    case "TASK_ALREADY_CLAIMED":
      return "Task already claimed"
    case "TASK_NOT_CLAIMABLE":
      return "Task is not claimable in current status"
    case "TASK_NOT_AGENT_EXECUTABLE":
      return "Task is not executable by agent in current status"
    case "AGENT_NOT_AVAILABLE":
      return "Assigned agent is not available"
    case "AGENT_EXECUTION_TIMEOUT":
      return "Agent execution timed out, please retry"
    case "AGENT_ENDPOINT_ERROR":
      return "Agent endpoint execution failed"
    case "AGENT_RUN_CONFLICT":
      return "Another agent run is active, please retry in a moment"
    case "TASK_RUN_RATE_LIMITED":
      return "Task run rate limit reached, please retry later"
    case "PROJECT_ACTOR_NOT_FOUND":
      return "Project actor is unavailable for this operation"
    case "NO_PROJECT_MEMBERSHIP":
    case "PROJECT_NOT_FOUND":
      return "No writable project available for this action"
    default:
      return fallback || "Operation failed, please retry later"
  }
}

export function mapTaskOpsApiError(code?: string, fallback?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Authentication required. Please sign in again."
    case "NOT_PROJECT_MEMBER":
      return "You are not a member of this project"
    case "INSUFFICIENT_PERMISSIONS":
      return "Insufficient permissions for this action"
    case "SCHEDULER_DISABLED":
      return "Project scheduler is disabled"
    case "AUTO_DISPATCH_CONFLICT":
      return "Another dispatch batch is running. Please retry in a moment."
    case "AGENT_NOT_AVAILABLE":
    case "AUTO_DISPATCH_NO_AGENT":
    case "AUTO_DISPATCH_NO_ONLINE_AGENT":
      return "No available agent for this queue domain at the moment"
    case "INVALID_REQUEST":
    case "INVALID_REQUEST_PAYLOAD":
    case "INVALID_JSON":
      return "Invalid request payload"
    case "PROJECT_ACTOR_NOT_FOUND":
      return "Project actor is unavailable for this operation"
    case "INTERNAL_ERROR":
    case "OPERATIONS_STATUS_FAILED":
      return "Service is temporarily unavailable. Please retry in a few seconds."
    default:
      return fallback || "Operation failed, please retry later"
  }
}

export function mapTaskApiErrorFromPayload(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === "object" ? (payload as ApiErrorPayload) : {}
  const code = asString(record.code)
  const message = asString(record.error) || fallback
  return mapTaskApiError(code, message)
}

export function mapTaskOpsApiErrorFromPayload(payload: unknown, fallback: string): string {
  const record = payload && typeof payload === "object" ? (payload as ApiErrorPayload) : {}
  const code = asString(record.code)
  const message = asString(record.error) || fallback
  return mapTaskOpsApiError(code, message)
}
