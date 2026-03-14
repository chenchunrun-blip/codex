"use client"

import { useEffect, useRef, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"

type OperationsStatusResponse = {
  generatedAt: string
  sourceProjectId: string | null
  projectCount: number
  queueBacklogTotal: number
  queueDomains: Array<{
    domain: string
    backlog: number
  }>
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
    topTypes: Array<{
      type: string
      count: number
    }>
  }
}

interface OperationsStatusPanelProps {
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
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{helper}</div>
    </div>
  )
}

const STATUS_FETCH_TIMEOUT_MS = 10000
const STATUS_FETCH_MAX_RETRIES = 2

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function OperationsStatusPanel({ projectId }: OperationsStatusPanelProps) {
  const [data, setData] = useState<OperationsStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const isFetchingRef = useRef(false)

  const fetchData = async (background = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    try {
      if (background) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      const params = new URLSearchParams()
      if (projectId) params.set("sourceProjectId", projectId)
      const query = params.toString() ? `?${params.toString()}` : ""

      let response: Response | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt <= STATUS_FETCH_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS)
        try {
          response = await fetch(`/api/operations/status${query}`, {
            signal: controller.signal
          })
          window.clearTimeout(timeout)
          break
        } catch (err) {
          window.clearTimeout(timeout)
          lastError = err
          if (attempt < STATUS_FETCH_MAX_RETRIES) {
            await sleep(300 * (attempt + 1))
          }
        }
      }

      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("Failed to fetch operations status")
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapTaskOpsApiErrorFromPayload(payload, "Failed to fetch operations status"))
      }
      const payload = (await response.json()) as OperationsStatusResponse
      setData(payload)
      setLastUpdatedAt(new Date().toISOString())
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Operations status is temporarily unavailable. Please refresh in a few seconds."
      setError(message)
      if (!background) {
        setData(null)
      }
    } finally {
      isFetchingRef.current = false
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
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
    fetchData().catch(() => undefined)
    const timer = window.setInterval(() => {
      if (!isPageVisible) return
      fetchData(true).catch(() => undefined)
    }, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [projectId, isPageVisible])

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Operations Status</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Auto refresh: 30s</span>
          <button
            type="button"
            aria-label="Refresh operations status"
            onClick={() => fetchData().catch(() => undefined)}
            disabled={loading || refreshing}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading || refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {lastUpdatedAt && (
        <div className="mb-2 text-[11px] text-gray-500">
          Last updated: {new Date(lastUpdatedAt).toLocaleString()}
        </div>
      )}
      {error && !loading && data && (
        <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}

      {loading ? (
        <div className="py-8 text-sm text-gray-500">Loading operations status...</div>
      ) : error && !data ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : !data ? (
        <div className="py-8 text-sm text-gray-500">No operations status available.</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            Scope: {data.sourceProjectId ? "single project" : "all accessible projects"} · Projects:{" "}
            <span className="font-medium">{data.projectCount}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <MetricCard
              label="Queue Backlog"
              value={String(data.queueBacklogTotal)}
              helper="Pending items in agent queues"
            />
            <MetricCard
              label="Scheduler Batches"
              value={`${data.scheduler.batchesCompleted24h}/${data.scheduler.batchesStarted24h}`}
              helper="Completed / started in last 24h"
            />
            <MetricCard
              label="Agent Runs"
              value={`${data.agentRuns.triggered24h}`}
              helper={`Failed: ${data.agentRuns.failed24h}`}
            />
            <MetricCard
              label="Saved Reports"
              value={String(data.reports.saved24h)}
              helper="Saved report files in last 24h"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Queue Domains</div>
              {data.queueDomains.length === 0 ? (
                <div className="text-xs text-gray-500">No queue backlog.</div>
              ) : (
                <div className="space-y-1">
                  {data.queueDomains.map((row) => (
                    <div key={row.domain} className="flex items-center justify-between text-xs text-gray-700">
                      <span>{row.domain}</span>
                      <span className="font-medium">{row.backlog}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Top Report Types (24h)</div>
              {data.reports.topTypes.length === 0 ? (
                <div className="text-xs text-gray-500">No saved report activity.</div>
              ) : (
                <div className="space-y-1">
                  {data.reports.topTypes.map((row) => (
                    <div key={row.type} className="flex items-center justify-between text-xs text-gray-700">
                      <span className="truncate pr-3">{row.type}</span>
                      <span className="font-medium">{row.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
