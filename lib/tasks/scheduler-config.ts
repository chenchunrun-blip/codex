import { ActionType } from "@prisma/client"
import { db } from "@/lib/db"

export type ProjectSchedulerConfig = {
  enabled: boolean
  defaultLimit: number
  defaultAutoSubmit: boolean
  updatedAt: string | null
  source: "project" | "default"
}

export const DEFAULT_PROJECT_SCHEDULER_CONFIG: Omit<ProjectSchedulerConfig, "updatedAt" | "source"> = {
  enabled: true,
  defaultLimit: 5,
  defaultAutoSubmit: true
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_PROJECT_SCHEDULER_CONFIG.defaultLimit
  return Math.min(20, Math.max(1, Math.floor(n)))
}

export function normalizeSchedulerConfig(input: unknown): Omit<ProjectSchedulerConfig, "updatedAt" | "source"> {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_PROJECT_SCHEDULER_CONFIG }
  }
  const obj = input as Record<string, unknown>
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_PROJECT_SCHEDULER_CONFIG.enabled,
    defaultLimit: clampLimit(obj.defaultLimit),
    defaultAutoSubmit:
      typeof obj.defaultAutoSubmit === "boolean"
        ? obj.defaultAutoSubmit
        : DEFAULT_PROJECT_SCHEDULER_CONFIG.defaultAutoSubmit
  }
}

export async function resolveProjectSchedulerConfig(projectId: string): Promise<ProjectSchedulerConfig> {
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
    if (metadata.type !== "PROJECT_SCHEDULER_CONFIG_UPDATED") continue
    return {
      ...normalizeSchedulerConfig({
        enabled: metadata.enabled,
        defaultLimit: metadata.defaultLimit,
        defaultAutoSubmit: metadata.defaultAutoSubmit
      }),
      updatedAt: log.createdAt.toISOString(),
      source: "project"
    }
  }

  return {
    ...DEFAULT_PROJECT_SCHEDULER_CONFIG,
    updatedAt: null,
    source: "default"
  }
}
