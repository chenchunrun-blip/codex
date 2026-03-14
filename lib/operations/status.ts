import { ActionType, AssigneeType, TaskStatus } from "@prisma/client"
import { db } from "@/lib/db"

type QueueDomain = {
  domain: string
  backlog: number
}

type TopType = {
  type: string
  count: number
}

export type OperationsStatusSummary = {
  generatedAt: string
  sourceProjectId: string | null
  projectCount: number
  queueBacklogTotal: number
  queueDomains: QueueDomain[]
  scheduler: {
    batchesStarted24h: number
    batchesCompleted24h: number
    autoDispatched24h: number
    autoDispatchFailed24h: number
    lastBatchAt: string | null
  }
  agentRuns: {
    triggered24h: number
    failed24h: number
  }
  reports: {
    saved24h: number
    topTypes: TopType[]
  }
}

export type OperationsHealthLevel = "HEALTHY" | "DEGRADED" | "CRITICAL"

export type OperationsHealthIssue = {
  code: string
  level: Exclude<OperationsHealthLevel, "HEALTHY">
  message: string
}

export type OperationsHealthSummary = {
  level: OperationsHealthLevel
  issueCount: number
  issues: OperationsHealthIssue[]
}

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as Record<string, unknown>).type
  return typeof type === "string" ? type : null
}

export function buildOperationsStatusMarkdown(input: OperationsStatusSummary): string {
  const lines: string[] = []
  lines.push("# Operations Status Report")
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt}`)
  lines.push(`- Source Project: ${input.sourceProjectId || "ALL_ACCESSIBLE"}`)
  lines.push(`- Projects Covered: ${input.projectCount}`)
  lines.push("")
  lines.push("## Agent Queue")
  lines.push(`- Total Backlog: ${input.queueBacklogTotal}`)
  if (input.queueDomains.length === 0) {
    lines.push("- No active queue backlog")
  } else {
    for (const item of input.queueDomains) {
      lines.push(`- ${item.domain}: ${item.backlog}`)
    }
  }
  lines.push("")
  lines.push("## Scheduler (24h)")
  lines.push(`- Batches Started: ${input.scheduler.batchesStarted24h}`)
  lines.push(`- Batches Completed: ${input.scheduler.batchesCompleted24h}`)
  lines.push(`- Auto Dispatched: ${input.scheduler.autoDispatched24h}`)
  lines.push(`- Auto Dispatch Failed: ${input.scheduler.autoDispatchFailed24h}`)
  lines.push(`- Last Batch At: ${input.scheduler.lastBatchAt || "-"}`)
  lines.push("")
  lines.push("## Agent Runs (24h)")
  lines.push(`- Triggered: ${input.agentRuns.triggered24h}`)
  lines.push(`- Failed: ${input.agentRuns.failed24h}`)
  lines.push("")
  lines.push("## Reports (24h)")
  lines.push(`- Saved Reports: ${input.reports.saved24h}`)
  if (input.reports.topTypes.length > 0) {
    lines.push("")
    lines.push("| Report Type | Count |")
    lines.push("| --- | --- |")
    for (const item of input.reports.topTypes) {
      lines.push(`| ${item.type.replace(/\|/g, "\\|")} | ${item.count} |`)
    }
  }
  return lines.join("\n")
}

export async function resolveOperationsStatus(input: {
  projectIds: string[]
  sourceProjectId?: string
}): Promise<OperationsStatusSummary> {
  const scopedProjectIds = input.sourceProjectId ? [input.sourceProjectId] : input.projectIds
  if (scopedProjectIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      sourceProjectId: input.sourceProjectId || null,
      projectCount: 0,
      queueBacklogTotal: 0,
      queueDomains: [],
      scheduler: {
        batchesStarted24h: 0,
        batchesCompleted24h: 0,
        autoDispatched24h: 0,
        autoDispatchFailed24h: 0,
        lastBatchAt: null
      },
      agentRuns: {
        triggered24h: 0,
        failed24h: 0
      },
      reports: {
        saved24h: 0,
        topTypes: []
      }
    }
  }

  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [queueRows, logs24h] = await Promise.all([
    db.task.groupBy({
      by: ["functionalAgentType"],
      where: {
        projectId: { in: scopedProjectIds },
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
      },
      _count: {
        _all: true
      }
    }),
    db.activityLog.findMany({
      where: {
        projectId: { in: scopedProjectIds },
        createdAt: { gte: since24h },
        action: { in: [ActionType.FILE_CREATED, ActionType.TASK_UPDATED] }
      },
      select: {
        createdAt: true,
        action: true,
        metadata: true
      },
      orderBy: { createdAt: "desc" },
      take: 3000
    })
  ])

  const queueDomains = queueRows
    .map((row) => ({
      domain: row.functionalAgentType || "UNSPECIFIED",
      backlog: row._count._all
    }))
    .sort((a, b) => b.backlog - a.backlog)
  const queueBacklogTotal = queueDomains.reduce((sum, item) => sum + item.backlog, 0)

  let batchesStarted24h = 0
  let batchesCompleted24h = 0
  let autoDispatched24h = 0
  let autoDispatchFailed24h = 0
  let triggered24h = 0
  let failed24h = 0
  let reportsSaved24h = 0
  const reportTypeMap = new Map<string, number>()
  let lastBatchAt: string | null = null

  for (const log of logs24h) {
    const type = metadataType(log.metadata)
    if (!type) continue

    if (type === "AGENT_AUTO_DISPATCH_BATCH_STARTED") {
      batchesStarted24h += 1
      if (!lastBatchAt) lastBatchAt = log.createdAt.toISOString()
    } else if (type === "AGENT_AUTO_DISPATCH_BATCH_COMPLETED") {
      batchesCompleted24h += 1
      if (!lastBatchAt) lastBatchAt = log.createdAt.toISOString()
    } else if (type === "AGENT_AUTO_DISPATCHED") {
      autoDispatched24h += 1
    } else if (type === "AGENT_AUTO_DISPATCH_FAILED") {
      autoDispatchFailed24h += 1
    } else if (type === "AGENT_RUN_TRIGGERED") {
      triggered24h += 1
    } else if (type === "AGENT_RUN_FAILED") {
      failed24h += 1
    }

    if (log.action === ActionType.FILE_CREATED && type.endsWith("_SAVED")) {
      reportsSaved24h += 1
      reportTypeMap.set(type, (reportTypeMap.get(type) || 0) + 1)
    }
  }

  const topTypes = Array.from(reportTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  return {
    generatedAt: now.toISOString(),
    sourceProjectId: input.sourceProjectId || null,
    projectCount: scopedProjectIds.length,
    queueBacklogTotal,
    queueDomains,
    scheduler: {
      batchesStarted24h,
      batchesCompleted24h,
      autoDispatched24h,
      autoDispatchFailed24h,
      lastBatchAt
    },
    agentRuns: {
      triggered24h,
      failed24h
    },
    reports: {
      saved24h: reportsSaved24h,
      topTypes
    }
  }
}

export function deriveOperationsHealth(status: OperationsStatusSummary): OperationsHealthSummary {
  const issues: OperationsHealthIssue[] = []

  if (status.queueBacklogTotal >= 40) {
    issues.push({
      code: "QUEUE_BACKLOG_CRITICAL",
      level: "CRITICAL",
      message: `Queue backlog is high (${status.queueBacklogTotal}).`
    })
  } else if (status.queueBacklogTotal >= 15) {
    issues.push({
      code: "QUEUE_BACKLOG_DEGRADED",
      level: "DEGRADED",
      message: `Queue backlog is elevated (${status.queueBacklogTotal}).`
    })
  }

  if (status.scheduler.autoDispatchFailed24h >= 5) {
    issues.push({
      code: "AUTO_DISPATCH_FAILURE_CRITICAL",
      level: "CRITICAL",
      message: `Auto dispatch failures are high (${status.scheduler.autoDispatchFailed24h} in 24h).`
    })
  } else if (status.scheduler.autoDispatchFailed24h > 0) {
    issues.push({
      code: "AUTO_DISPATCH_FAILURE_DEGRADED",
      level: "DEGRADED",
      message: `Auto dispatch has failures (${status.scheduler.autoDispatchFailed24h} in 24h).`
    })
  }

  if (status.scheduler.batchesStarted24h > 0 && status.scheduler.batchesCompleted24h === 0) {
    issues.push({
      code: "SCHEDULER_STALLED",
      level: "CRITICAL",
      message: "Scheduler started batches but none completed in 24h."
    })
  }

  const pendingBatches = status.scheduler.batchesStarted24h - status.scheduler.batchesCompleted24h
  if (pendingBatches >= 3) {
    issues.push({
      code: "SCHEDULER_BACKLOG",
      level: "DEGRADED",
      message: `Scheduler has ${pendingBatches} unclosed batches in 24h window.`
    })
  }

  const failedRuns = status.agentRuns.failed24h
  const triggeredRuns = status.agentRuns.triggered24h
  const failedRate = triggeredRuns > 0 ? failedRuns / triggeredRuns : failedRuns > 0 ? 1 : 0
  if (failedRuns >= 5 && failedRate >= 0.2) {
    issues.push({
      code: "AGENT_RUN_FAILURE_CRITICAL",
      level: "CRITICAL",
      message: `Agent run failure rate is high (${Math.round(failedRate * 100)}%).`
    })
  } else if (failedRuns > 0) {
    issues.push({
      code: "AGENT_RUN_FAILURE_DEGRADED",
      level: "DEGRADED",
      message: `Agent runs have failures (${failedRuns} in 24h).`
    })
  }

  const level: OperationsHealthLevel = issues.some((issue) => issue.level === "CRITICAL")
    ? "CRITICAL"
    : issues.length > 0
      ? "DEGRADED"
      : "HEALTHY"

  return {
    level,
    issueCount: issues.length,
    issues
  }
}
