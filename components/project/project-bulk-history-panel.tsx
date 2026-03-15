"use client"

import { useEffect, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface BulkHistoryItem {
  projectId: string
  projectName: string
  createdAt: string
  triggerMode: string
  total: number
  successCount: number
  failedCount: number
  batchId: string | null
  idempotencyKey: string | null
  failedTaskIds: string[]
}

interface ProjectBulkHistoryPanelProps {
  projectIds: string[]
}
const REQUEST_OPTIONS = { timeoutMs: 10000, maxRetries: 2, retryDelayMs: 300 }

export function ProjectBulkHistoryPanel({ projectIds }: ProjectBulkHistoryPanelProps) {
  const [history, setHistory] = useState<BulkHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null)

  const fetchHistory = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchWithTimeoutRetry(
        "/api/tasks/scheduler/bulk-history?days=14",
        {},
        REQUEST_OPTIONS
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(data, "Failed to fetch bulk history"))
      }
      const data = await response.json()
      const rows = Array.isArray(data?.history) ? data.history : []
      setHistory(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch bulk history")
      setHistory([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectIds.length === 0) {
      setHistory([])
      setLoading(false)
      return
    }
    fetchHistory().catch(() => undefined)
  }, [projectIds.join(",")])

  const retryFailedBatch = async (item: BulkHistoryItem) => {
    if (item.failedTaskIds.length === 0) return
    setRetryingBatchId(item.batchId || item.idempotencyKey || item.createdAt)
    setError(null)
    try {
      const response = await fetchWithTimeoutRetry(
        "/api/tasks/scheduler/trigger",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: item.projectId,
            taskIds: item.failedTaskIds,
            limit: Math.min(20, item.failedTaskIds.length),
            autoSubmit: true,
            idempotencyKey: `history-retry-${item.projectId}-${Date.now()}`
          })
        },
        REQUEST_OPTIONS
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(data, "Failed to retry failed batch"))
      }
      await fetchHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry failed batch")
    } finally {
      setRetryingBatchId(null)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Cross-Project Scheduler History</h2>
        <button
          onClick={() => fetchHistory()}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500">Recent scheduler batch results across accessible projects.</p>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-500">Loading history...</div>
      ) : error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : history.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-500">No scheduler history yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-2 py-1.5 font-medium">Time</th>
                <th className="px-2 py-1.5 font-medium">Project</th>
                <th className="px-2 py-1.5 font-medium">Mode</th>
                <th className="px-2 py-1.5 font-medium">Total</th>
                <th className="px-2 py-1.5 font-medium">Success</th>
                <th className="px-2 py-1.5 font-medium">Failed</th>
                <th className="px-2 py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => {
                const rowKey = item.batchId || item.idempotencyKey || `${item.projectId}-${item.createdAt}`
                const rowRetrying = retryingBatchId === rowKey
                return (
                  <tr key={rowKey} className="border-b border-gray-100">
                    <td className="px-2 py-1.5 text-gray-700">{new Date(item.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-gray-700">{item.projectName}</td>
                    <td className="px-2 py-1.5 text-gray-700">{item.triggerMode}</td>
                    <td className="px-2 py-1.5 text-gray-700">{item.total}</td>
                    <td className="px-2 py-1.5 text-green-700">{item.successCount}</td>
                    <td className="px-2 py-1.5 text-red-700">{item.failedCount}</td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => retryFailedBatch(item)}
                        disabled={item.failedTaskIds.length === 0 || rowRetrying}
                        className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {rowRetrying ? "Retrying..." : `Retry failed (${item.failedTaskIds.length})`}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
