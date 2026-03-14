"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

type MetricsResponse = {
  scope: { projectId: string | null; days: number }
  degraded?: boolean
  retryableErrorCodes: string[]
  availableRetryableErrorCodes: string[]
  retryConfigUpdatedAt: string | null
  retryConfigSource: "project" | "default"
  dispatchPolicyOnlineOnly: boolean | null
  dispatchPolicySource: "project" | "default" | "mixed"
  backlog: {
    total: number
    byQueueDomain: Array<{ domain: string; count: number }>
  }
  execution: {
    runs: number
    success: number
    failed: number
    successRate: number
  }
  completion: {
    completedTasks: number
    avgCompletionHours: number | null
  }
  risk: {
    overdue: number
    dueIn24h: number
    dueIn3d: number
    total: number
  }
  failures: Array<{ reason: string; count: number }>
  dispatchHistory: Array<{
    createdAt: string
    total: number
    successCount: number
    failedCount: number
    triggerMode: string
    batchId: string | null
    idempotencyKey: string | null
    failedTasks: Array<{
      taskId: string
      error: string
      errorCode: string
    }>
  }>
}

type SchedulerTriggerResponse = {
  projectId: string
  total: number
  successCount: number
  failedCount: number
  triggerMode: "MANUAL" | "SCHEDULED"
  deduplicated?: boolean
  results: Array<{
    taskId: string
    status: "SUCCESS" | "FAILED"
    executionId?: string
    deliverableId?: string
    runtimeMode?: string
    error?: string
    errorCode?: string
  }>
}

interface TaskOperationsSnapshotProps {
  projectId?: string
}

function MetricCard({
  label,
  value,
  helper
}: {
  label: string
  value: string
  helper: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{helper}</div>
    </div>
  )
}

const METRICS_FETCH_TIMEOUT_MS = 8000
const METRICS_FETCH_MAX_RETRIES = 2

const SNAPSHOT_KEY_PREFIX = "task-operations-snapshot:"

function getSnapshotKey(projectId?: string) {
  return `${SNAPSHOT_KEY_PREFIX}${projectId || "all"}`
}

export function TaskOperationsSnapshot({ projectId }: TaskOperationsSnapshotProps) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [dispatchLimit, setDispatchLimit] = useState(5)
  const [dispatchAutoSubmit, setDispatchAutoSubmit] = useState(true)
  const [isDispatching, setIsDispatching] = useState(false)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [dispatchResult, setDispatchResult] = useState<SchedulerTriggerResponse | null>(null)
  const [expandedHistoryRows, setExpandedHistoryRows] = useState<string[]>([])
  const [retryingRowKey, setRetryingRowKey] = useState<string | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const isFetchingRef = useRef(false)

  const retryableErrorCodeSet = new Set(
    metrics?.retryableErrorCodes?.length
      ? metrics.retryableErrorCodes
      : ["AGENT_EXECUTION_TIMEOUT", "AGENT_ENDPOINT_ERROR", "AGENT_RUN_CONFLICT"]
  )

  const availableRetryableCodeSet = new Set(
    metrics?.availableRetryableErrorCodes?.length
      ? metrics.availableRetryableErrorCodes
      : ["AGENT_EXECUTION_TIMEOUT", "AGENT_ENDPOINT_ERROR", "AGENT_RUN_CONFLICT"]
  )

  const toggleHistoryRow = (key: string) => {
    setExpandedHistoryRows((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    )
  }

  const fetchMetrics = async (background = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const params = new URLSearchParams()
      if (projectId) params.set("projectId", projectId)
      params.set("days", "14")
      const response = await fetchWithTimeoutRetry(`/api/tasks/metrics?${params.toString()}`, {}, {
        timeoutMs: METRICS_FETCH_TIMEOUT_MS,
        maxRetries: METRICS_FETCH_MAX_RETRIES,
        retryDelayMs: 300
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(data, "Failed to fetch task metrics"))
      }
      const data = (await response.json()) as MetricsResponse
      setMetrics(data)
      try {
        window.sessionStorage.setItem(getSnapshotKey(projectId), JSON.stringify(data))
      } catch {
        // ignore storage failures
      }
      setLastUpdatedAt(new Date().toISOString())
      setDegradedNotice(
        data.degraded
          ? "Task metrics are temporarily degraded and may be incomplete."
          : null
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load task metrics"
      setError(
        message === "Failed to fetch task metrics"
          ? "Task metrics are temporarily unavailable. Please refresh in a few seconds."
          : message
      )
      if (!background) {
        try {
          const raw = window.sessionStorage.getItem(getSnapshotKey(projectId))
          if (raw) {
            const cached = JSON.parse(raw) as MetricsResponse
            if (cached && cached.backlog && cached.execution && cached.completion && cached.risk) {
              setMetrics(cached)
            } else {
              setMetrics(null)
            }
          } else {
            setMetrics(null)
          }
        } catch {
          setMetrics(null)
        }
      }
      setDegradedNotice(null)
    } finally {
      isFetchingRef.current = false
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  const runScheduler = async () => {
    if (!projectId) return
    setIsDispatching(true)
    setDispatchError(null)

    try {
      const idempotencyKey = `manual-${projectId}-${Date.now()}`
      const response = await fetch("/api/tasks/scheduler/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          limit: dispatchLimit,
          autoSubmit: dispatchAutoSubmit,
          idempotencyKey
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(data, "Failed to trigger scheduler"))
      }

      const data = (await response.json()) as SchedulerTriggerResponse
      setDispatchResult(data)
      await fetchMetrics()
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Failed to trigger scheduler")
    } finally {
      setIsDispatching(false)
    }
  }

  const retryFailedTasks = async (rowKey: string, failedItems: Array<{ taskId: string; errorCode: string }>) => {
    if (!projectId || failedItems.length === 0) return
    const retryableTaskIds = failedItems
      .filter((item) => retryableErrorCodeSet.has(item.errorCode) && availableRetryableCodeSet.has(item.errorCode))
      .map((item) => item.taskId)
    if (retryableTaskIds.length === 0) {
      setDispatchError("No retryable failed tasks in this batch (non-runtime errors were skipped).")
      return
    }
    setRetryingRowKey(rowKey)
    setDispatchError(null)

    try {
      const idempotencyKey = `retry-${projectId}-${Date.now()}`
      const response = await fetch("/api/tasks/scheduler/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          limit: Math.min(20, retryableTaskIds.length),
          autoSubmit: dispatchAutoSubmit,
          idempotencyKey,
          taskIds: retryableTaskIds
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(data, "Failed to retry failed tasks"))
      }

      const data = (await response.json()) as SchedulerTriggerResponse
      setDispatchResult(data)
      await fetchMetrics()
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Failed to retry failed tasks")
    } finally {
      setRetryingRowKey(null)
    }
  }

  useEffect(() => {
    const handleVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible")
    }
    handleVisibility()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  useEffect(() => {
    fetchMetrics().catch(() => undefined)
    const timer = window.setInterval(() => {
      if (!isPageVisible) return
      fetchMetrics(true).catch(() => undefined)
    }, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [projectId, isPageVisible])

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Operations Snapshot</h2>
          <p className="text-xs text-gray-500">Last 14 days performance for current task scope</p>
          {lastUpdatedAt && (
            <p className="mt-1 text-[11px] text-gray-500">
              Last updated: {new Date(lastUpdatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600">
            Limit
            <input
              type="number"
              min={1}
              max={20}
              value={dispatchLimit}
              onChange={(e) => setDispatchLimit(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className="ml-2 w-16 rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={dispatchAutoSubmit}
              onChange={(e) => setDispatchAutoSubmit(e.target.checked)}
            />
            Auto-submit
          </label>
          <button
            type="button"
            onClick={runScheduler}
            disabled={!projectId || isDispatching}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={projectId ? "Run scheduler dispatch for selected project" : "Select a project first"}
          >
            {isDispatching ? "Running..." : "Run Scheduler"}
          </button>
          <button
            type="button"
            aria-label="Refresh task operations snapshot"
            onClick={() => fetchMetrics().catch(() => undefined)}
            disabled={loading || refreshing}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading || refreshing ? "Refreshing..." : "Refresh Metrics"}
          </button>
        </div>
      </div>

      {!projectId && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Select a project in the filter above to enable manual scheduler trigger.
        </div>
      )}

      {dispatchError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {dispatchError}
        </div>
      )}

      {dispatchResult && (
        <div className="mb-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          Last dispatch ({dispatchResult.triggerMode})
          {dispatchResult.deduplicated ? " [deduplicated]" : ""}: total {dispatchResult.total}, success{" "}
          {dispatchResult.successCount}, failed {dispatchResult.failedCount}
        </div>
      )}
      {error && !loading && metrics && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-500">Loading metrics...</div>
      ) : error && !metrics ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : !metrics ? (
        <div className="py-8 text-center text-sm text-gray-500">No metrics available</div>
      ) : (
        <div className="space-y-4">
          {degradedNotice && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {degradedNotice}
            </div>
          )}
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
            Dispatch Policy:{" "}
            <span className="font-medium">
              {metrics.dispatchPolicyOnlineOnly === null
                ? "mixed (cross-project scope)"
                : metrics.dispatchPolicyOnlineOnly
                  ? "online-only"
                  : "all-active"}
            </span>{" "}
            · Source: {metrics.dispatchPolicySource}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <MetricCard
              label="Queue Backlog"
              value={String(metrics.backlog.total)}
              helper="Pending tasks in agent queues"
            />
            <MetricCard
              label="Execution Success"
              value={`${metrics.execution.successRate}%`}
              helper={`${metrics.execution.success}/${metrics.execution.runs} successful runs`}
            />
            <MetricCard
              label="Execution Failures"
              value={String(metrics.execution.failed)}
              helper="Agent run failures in the selected window"
            />
            <MetricCard
              label="Avg Completion"
              value={
                metrics.completion.avgCompletionHours === null
                  ? "N/A"
                  : `${metrics.completion.avgCompletionHours}h`
              }
              helper={`Based on ${metrics.completion.completedTasks} completed agent tasks`}
            />
            <MetricCard
              label="Risk Tasks"
              value={String(metrics.risk.total)}
              helper={`Overdue ${metrics.risk.overdue} · 24h ${metrics.risk.dueIn24h} · 3d ${metrics.risk.dueIn3d}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Queue Domain Backlog</div>
              {metrics.backlog.byQueueDomain.length === 0 ? (
                <div className="text-sm text-gray-500">No queued tasks</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {metrics.backlog.byQueueDomain.map((item) => (
                    <span
                      key={item.domain}
                      className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700"
                    >
                      {item.domain}: {item.count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Top Failure Reasons</div>
              {metrics.failures.length === 0 ? (
                <div className="text-sm text-gray-500">No failures recorded</div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {metrics.failures.map((item) => (
                    <div key={item.reason} className="flex items-center justify-between gap-3">
                      <span className="text-gray-700">{item.reason}</span>
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-gray-900">Recent Dispatch Batches</div>
            {metrics.dispatchHistory.length === 0 ? (
              <div className="text-sm text-gray-500">No recent dispatch batches</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th scope="col" className="px-2 py-1.5 font-medium">Time</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Mode</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Total</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Success</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Failed</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Batch</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.dispatchHistory.map((item) => {
                      const rowKey = `${item.createdAt}-${item.batchId || "none"}`
                      const isExpanded = expandedHistoryRows.includes(rowKey)
                      const retryableCount = item.failedTasks.filter((failedItem) =>
                        retryableErrorCodeSet.has(failedItem.errorCode) &&
                        availableRetryableCodeSet.has(failedItem.errorCode)
                      ).length
                      return (
                        <Fragment key={rowKey}>
                          <tr key={rowKey} className="border-b border-gray-100">
                            <td className="px-2 py-1.5 text-gray-700">{new Date(item.createdAt).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-gray-700">{item.triggerMode}</td>
                            <td className="px-2 py-1.5 text-gray-700">{item.total}</td>
                            <td className="px-2 py-1.5 text-green-700">{item.successCount}</td>
                            <td className="px-2 py-1.5 text-red-700">{item.failedCount}</td>
                            <td className="px-2 py-1.5 text-gray-500">{item.batchId ? item.batchId.slice(0, 8) : "-"}</td>
                            <td className="px-2 py-1.5">
                              {item.failedTasks.length > 0 ? (
                                <button
                                  aria-label={isExpanded ? "Hide failed task details" : "Show failed task details"}
                                  aria-expanded={isExpanded}
                                  onClick={() => toggleHistoryRow(rowKey)}
                                  className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-200"
                                >
                                  {isExpanded ? "Hide" : "Show"}
                                </button>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && item.failedTasks.length > 0 && (
                            <tr key={`${rowKey}-details`} className="border-b border-gray-100 bg-red-50/40">
                              <td colSpan={7} className="px-2 py-2">
                                <div className="space-y-1 text-[11px]">
                                  {item.failedTasks.map((failedItem) => (
                                    <div
                                      key={`${rowKey}-${failedItem.taskId}-${failedItem.error}-${failedItem.errorCode}`}
                                      className="flex items-start justify-between gap-3"
                                    >
                                      <span className="font-medium text-red-700">{failedItem.taskId}</span>
                                      <span className="text-red-600">
                                        [{failedItem.errorCode}] {failedItem.error}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <span className="mr-2 self-center text-[11px] text-gray-600">
                                    Retryable: {retryableCount}
                                  </span>
                                  <button
                                    aria-label={`Retry ${retryableCount} retryable failed tasks`}
                                    onClick={() =>
                                      retryFailedTasks(
                                        rowKey,
                                        item.failedTasks.map((failedItem) => ({
                                          taskId: failedItem.taskId,
                                          errorCode: failedItem.errorCode
                                        }))
                                      )
                                    }
                                    disabled={!projectId || retryingRowKey === rowKey || retryableCount === 0}
                                    className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {retryingRowKey === rowKey ? "Retrying..." : "Retry failed runtime errors"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
