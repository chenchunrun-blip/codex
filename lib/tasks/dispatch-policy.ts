import { ActionType } from "@prisma/client"
import { db } from "@/lib/db"

export type ProjectDispatchPolicy = {
  onlineOnly: boolean
  updatedAt: string | null
  source: "project" | "default"
}

export const DEFAULT_PROJECT_DISPATCH_POLICY: Omit<ProjectDispatchPolicy, "updatedAt" | "source"> = {
  onlineOnly: false
}

export function normalizeDispatchPolicy(input: unknown): Omit<ProjectDispatchPolicy, "updatedAt" | "source"> {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_PROJECT_DISPATCH_POLICY }
  }
  const obj = input as Record<string, unknown>
  return {
    onlineOnly:
      typeof obj.onlineOnly === "boolean"
        ? obj.onlineOnly
        : DEFAULT_PROJECT_DISPATCH_POLICY.onlineOnly
  }
}

export function resolveProjectDispatchPolicyFromLogs(
  logs: Array<{ metadata: unknown; createdAt: Date }>
): ProjectDispatchPolicy {
  for (const log of logs) {
    if (!log.metadata || typeof log.metadata !== "object") continue
    const metadata = log.metadata as Record<string, unknown>
    if (metadata.type !== "PROJECT_DISPATCH_POLICY_UPDATED") continue
    return {
      ...normalizeDispatchPolicy({
        onlineOnly: metadata.onlineOnly
      }),
      updatedAt: log.createdAt.toISOString(),
      source: "project"
    }
  }

  return {
    ...DEFAULT_PROJECT_DISPATCH_POLICY,
    updatedAt: null,
    source: "default"
  }
}

export async function resolveProjectDispatchPolicy(projectId: string): Promise<ProjectDispatchPolicy> {
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

  return resolveProjectDispatchPolicyFromLogs(Array.isArray(logs) ? logs : [])
}
