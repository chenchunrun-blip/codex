import { db } from "@/lib/db"
import { isReportMetadataType } from "@/lib/reports/metadata"
import { ActionType } from "@prisma/client"

const MAX_REPORT_HISTORY_SCAN = 5000

export type ReportHistoryItem = {
  createdAt: string
  type: string
  projectId: string | null
  projectName: string
  actorName: string
  fileName: string
  fileId: string | null
}

function metadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).type
  return typeof value === "string" ? value : null
}

type QueryReportsHistoryInput = {
  projectIds: string[]
  typeFilter?: string
  q?: string
  limit?: number
  offset?: number
}

function normalizeHistoryParams(input: QueryReportsHistoryInput) {
  const normalizedType = (input.typeFilter || "").trim()
  const normalizedQ = (input.q || "").trim().toLowerCase()
  const normalizedLimit = Math.min(Math.max(Math.trunc(input.limit || 50), 1), 200)
  const normalizedOffset = Math.max(Math.trunc(input.offset || 0), 0)
  return { normalizedType, normalizedQ, normalizedLimit, normalizedOffset }
}

async function fetchFilteredHistoryRows({
  projectIds,
  normalizedType,
  normalizedQ,
  scanWindow
}: {
  projectIds: string[]
  normalizedType: string
  normalizedQ: string
  scanWindow: number
}): Promise<ReportHistoryItem[]> {
  if (projectIds.length === 0) {
    return []
  }

  // Bound scan to last 90 days to avoid full table scans at scale
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const logs = await db.activityLog.findMany({
    where: {
      action: ActionType.FILE_CREATED,
      projectId: { in: projectIds },
      createdAt: { gte: since90d }
    },
    orderBy: { createdAt: "desc" },
    take: scanWindow,
    select: {
      createdAt: true,
      metadata: true,
      file: {
        select: {
          id: true,
          name: true
        }
      },
      project: {
        select: {
          id: true,
          name: true
        }
      },
      user: {
        select: {
          name: true,
          email: true
        }
      }
    }
  })

  return logs
    .map((log) => {
      const type = metadataType(log.metadata) || "UNKNOWN"
      return {
        createdAt: log.createdAt.toISOString(),
        type,
        fileId: log.file?.id || null,
        fileName: log.file?.name || "report.md",
        projectId: log.project?.id || null,
        projectName: log.project?.name || "Unknown project",
        actorName: log.user?.name || log.user?.email || "Unknown user"
      }
    })
    .filter((item) => isReportMetadataType(item.type))
    .filter((item) => (normalizedType ? item.type === normalizedType : true))
    .filter((item) => {
      if (!normalizedQ) return true
      const text = `${item.type} ${item.projectName} ${item.fileName} ${item.actorName}`.toLowerCase()
      return text.includes(normalizedQ)
    })
}

export async function queryReportsHistory(input: QueryReportsHistoryInput): Promise<ReportHistoryItem[]> {
  const { normalizedType, normalizedQ, normalizedLimit, normalizedOffset } = normalizeHistoryParams(input)
  if (normalizedOffset >= MAX_REPORT_HISTORY_SCAN) {
    return []
  }
  const scanWindow = Math.min(
    Math.max((normalizedOffset + normalizedLimit) * 2, 80),
    MAX_REPORT_HISTORY_SCAN
  )
  const filtered = await fetchFilteredHistoryRows({
    projectIds: input.projectIds,
    normalizedType,
    normalizedQ,
    scanWindow
  })
  return filtered.slice(normalizedOffset, normalizedOffset + normalizedLimit)
}

export async function queryReportsHistoryPage(input: QueryReportsHistoryInput): Promise<{
  history: ReportHistoryItem[]
  hasMore: boolean
}> {
  const { normalizedType, normalizedQ, normalizedLimit, normalizedOffset } = normalizeHistoryParams(input)
  if (normalizedOffset >= MAX_REPORT_HISTORY_SCAN) {
    return { history: [], hasMore: false }
  }
  const scanWindow = Math.min(
    Math.max((normalizedOffset + normalizedLimit + 1) * 2, 80),
    MAX_REPORT_HISTORY_SCAN
  )
  const filtered = await fetchFilteredHistoryRows({
    projectIds: input.projectIds,
    normalizedType,
    normalizedQ,
    scanWindow
  })
  const pageSlice = filtered.slice(normalizedOffset, normalizedOffset + normalizedLimit + 1)
  return {
    history: pageSlice.slice(0, normalizedLimit),
    hasMore: pageSlice.length > normalizedLimit
  }
}
