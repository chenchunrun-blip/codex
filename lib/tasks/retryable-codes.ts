import { ActionType } from "@prisma/client"
import { db } from "@/lib/db"

export const AVAILABLE_RETRYABLE_ERROR_CODES = [
  "AGENT_EXECUTION_TIMEOUT",
  "AGENT_ENDPOINT_ERROR",
  "AGENT_RUN_CONFLICT",
  "TASK_RUN_RATE_LIMITED",
  "AUTO_DISPATCH_CONFLICT"
] as const

export const DEFAULT_RETRYABLE_ERROR_CODES = [
  "AGENT_EXECUTION_TIMEOUT",
  "AGENT_ENDPOINT_ERROR",
  "AGENT_RUN_CONFLICT"
] as const

const AVAILABLE_SET = new Set<string>(AVAILABLE_RETRYABLE_ERROR_CODES)

export function normalizeRetryableCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_RETRYABLE_ERROR_CODES]
  const normalized = Array.from(
    new Set(
      input
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((code) => AVAILABLE_SET.has(code))
    )
  )
  return normalized.length > 0 ? normalized : [...DEFAULT_RETRYABLE_ERROR_CODES]
}

export async function resolveProjectRetryableCodes(projectId: string): Promise<{
  retryableErrorCodes: string[]
  updatedAt: string | null
  source: "project" | "default"
}> {
  const logs = await db.activityLog.findMany({
    where: {
      projectId,
      taskId: null,
      action: ActionType.TASK_UPDATED
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      metadata: true,
      createdAt: true
    }
  })

  for (const log of logs) {
    if (!log.metadata || typeof log.metadata !== "object") continue
    const metadata = log.metadata as Record<string, unknown>
    if (metadata.type !== "PROJECT_RETRYABLE_ERROR_CODES_UPDATED") continue
    return {
      retryableErrorCodes: normalizeRetryableCodes(metadata.retryableErrorCodes),
      updatedAt: log.createdAt.toISOString(),
      source: "project"
    }
  }

  return {
    retryableErrorCodes: [...DEFAULT_RETRYABLE_ERROR_CODES],
    updatedAt: null,
    source: "default"
  }
}
