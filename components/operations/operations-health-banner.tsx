"use client"

import { useEffect, useRef, useState } from "react"
import type { OperationsHealthSummary } from "@/lib/operations/status"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type OperationsHealthResponse = {
  generatedAt: string
  sourceProjectId: string | null
  health: OperationsHealthSummary
}

interface OperationsHealthBannerProps {
  projectId?: string
}

const HEALTH_FETCH_INTERVAL_MS = 30 * 1000
const HEALTH_FETCH_TIMEOUT_MS = 10000
const HEALTH_FETCH_MAX_RETRIES = 2

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const HEALTH_SNAPSHOT_KEY_PREFIX = "operations-health:snapshot:"

function getHealthSnapshotKey(projectId?: string) {
  return `${HEALTH_SNAPSHOT_KEY_PREFIX}${projectId || "all"}`
}

export function OperationsHealthBanner({ projectId }: OperationsHealthBannerProps) {
  const [data, setData] = useState<OperationsHealthResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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
      for (let attempt = 0; attempt <= HEALTH_FETCH_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS)
        try {
          response = await fetch(`/api/operations/health${query}`, {
            signal: controller.signal
          })
          window.clearTimeout(timeout)
          break
        } catch (err) {
          window.clearTimeout(timeout)
          lastError = err
          if (attempt < HEALTH_FETCH_MAX_RETRIES) {
            await sleep(300 * (attempt + 1))
          }
        }
      }
      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("Failed to fetch operations health")
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch operations health"))
      }
      const payload = (await response.json()) as OperationsHealthResponse
      setData(payload)
      try {
        window.sessionStorage.setItem(getHealthSnapshotKey(projectId), JSON.stringify(payload))
      } catch {
        // ignore storage failures
      }
      setLastUpdatedAt(new Date().toISOString())
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Operations health is temporarily unavailable. Please refresh in a few seconds."
      setError(message)
      if (!background) {
        try {
          const raw = window.sessionStorage.getItem(getHealthSnapshotKey(projectId))
          if (raw) {
            const cached = JSON.parse(raw) as OperationsHealthResponse
            if (cached && cached.health) {
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
    }, HEALTH_FETCH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [projectId, isPageVisible])

  if (loading) {
    return (
      <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        Loading operations health...
      </div>
    )
  }

  if (error) {
    if (!data) {
      return (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )
    }
  }

  if (!data) {
    return null
  }

  const { health } = data
  const palette =
    health.level === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-800"
      : health.level === "DEGRADED"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-800"

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${palette}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Operations Health: {health.level}
        </div>
        <div className="flex items-center gap-2 text-xs opacity-80">
          <span>Issues: {health.issueCount}</span>
          <button
            type="button"
            aria-label="Refresh operations health"
            onClick={() => fetchData().catch(() => undefined)}
            disabled={loading || refreshing}
            className="rounded border border-current px-2 py-1 text-[11px] hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading || refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {lastUpdatedAt && (
        <div className="mt-1 text-[11px] opacity-80">
          Last updated: {new Date(lastUpdatedAt).toLocaleString()}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}
      {health.issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {health.issues.slice(0, 3).map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-xs">No immediate operational issues detected.</div>
      )}
    </div>
  )
}
