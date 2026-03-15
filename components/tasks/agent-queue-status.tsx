"use client"

import { useEffect, useRef, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

type QueueDomainStatus = {
  domain: string
  backlog: number
  activeAgents: number
  onlineAgents: number
}

type QueueStatusResponse = {
  projectId: string | null
  domains: QueueDomainStatus[]
  degraded?: boolean
}

interface AgentQueueStatusProps {
  projectId?: string
}

const QUEUE_FETCH_TIMEOUT_MS = 10000
const QUEUE_FETCH_MAX_RETRIES = 3

const SNAPSHOT_KEY_PREFIX = "agent-queue-status:snapshot:"

function getSnapshotKey(projectId?: string) {
  return `${SNAPSHOT_KEY_PREFIX}${projectId || "all"}`
}

export function AgentQueueStatus({ projectId }: AgentQueueStatusProps) {
  const [data, setData] = useState<QueueStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null)
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
      const query = projectId ? `?projectId=${projectId}` : ""
      const response = await fetchWithTimeoutRetry(`/api/agents/queue-status${query}`, {}, {
        timeoutMs: QUEUE_FETCH_TIMEOUT_MS,
        maxRetries: QUEUE_FETCH_MAX_RETRIES,
        retryDelayMs: 300
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const message = mapTaskOpsApiErrorFromPayload(payload, "Failed to fetch queue status")
        throw new Error(message)
      }
      const payload = (await response.json()) as QueueStatusResponse
      setData(payload)
      try {
        window.sessionStorage.setItem(getSnapshotKey(projectId), JSON.stringify(payload))
      } catch {
        // ignore storage failures
      }
      setLastUpdatedAt(new Date().toISOString())
      setDegradedNotice(
        payload.degraded
          ? "Agent queue status is temporarily degraded and may be incomplete."
          : null
      )
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Agent queue status is temporarily unavailable. Please refresh in a few seconds."
      setError(message)
      if (!background) {
        try {
          const raw = window.sessionStorage.getItem(getSnapshotKey(projectId))
          if (raw) {
            const cached = JSON.parse(raw) as QueueStatusResponse
            if (cached && Array.isArray(cached.domains)) {
              setData(cached)
            } else {
              setData(null)
            }
          } else {
            setData(null)
          }
        } catch {
          setData(null)
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
        <h2 className="text-sm font-semibold text-gray-900">Agent Queue Status</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Auto refresh: 30s</span>
          <button
            type="button"
            aria-label="Refresh agent queue status"
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
      {degradedNotice && !loading && !error && (
        <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {degradedNotice}
        </div>
      )}
      {error && !loading && data && (
        <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading queue status...</div>
      ) : error && !data ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : !data || data.domains.length === 0 ? (
        <div className="text-sm text-gray-500">No queue domains available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th scope="col" className="py-2 pr-4">Domain</th>
                <th scope="col" className="py-2 pr-4">Backlog</th>
                <th scope="col" className="py-2 pr-4">Online Agents</th>
                <th scope="col" className="py-2 pr-4">Active Agents</th>
              </tr>
            </thead>
            <tbody>
              {data.domains.map((row) => (
                <tr key={row.domain} className="border-b border-gray-100 text-gray-800">
                  <td className="py-2 pr-4 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{row.domain}</span>
                      {row.backlog > 0 && row.onlineAgents === 0 && (
                        <span aria-label={`${row.domain} domain is at risk`} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          AT RISK
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-4">{row.backlog}</td>
                  <td className="py-2 pr-4">{row.onlineAgents}</td>
                  <td className="py-2 pr-4">{row.activeAgents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
