"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type TeamStarterHistoryItem = {
  createdAt: string
  projectId: string | null
  projectName: string | null
  packId: string | null
  packName: string | null
  templateId: string | null
  templateName: string | null
  templateCategory: string | null
  artifactType: "PACK" | "TEMPLATE"
  scope: string
  dryRun: boolean
  createdCount: number
  wouldCreateCount: number
  skippedCount: number
  actor: {
    id: string
    name: string | null
    email: string
  } | null
}

type RolloutSummary = {
  days: number
  runs: number
  packRuns: number
  templateRuns: number
  dryRuns: number
  createdTotal: number
  skippedTotal: number
}

interface TeamStarterPackHistoryPanelProps {
  teamId: string
}

export function TeamStarterPackHistoryPanel({ teamId }: TeamStarterPackHistoryPanelProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<TeamStarterHistoryItem[]>([])
  const [typeFilter, setTypeFilter] = useState<"ALL" | "PACK" | "TEMPLATE">("ALL")
  const [copying, setCopying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copyingSummary, setCopyingSummary] = useState(false)
  const [downloadingSummary, setDownloadingSummary] = useState(false)
  const [summary7d, setSummary7d] = useState<RolloutSummary | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const isFetchingRef = useRef(false)

  const localKpi = (() => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = history.filter((item) => {
      const ts = new Date(item.createdAt).getTime()
      return Number.isFinite(ts) && ts >= since
    })
    return {
      runs: recent.length,
      packRuns: recent.filter((item) => item.artifactType === "PACK").length,
      templateRuns: recent.filter((item) => item.artifactType === "TEMPLATE").length,
      dryRuns: recent.filter((item) => item.dryRun).length,
      createdTotal: recent.reduce((acc, item) => acc + (item.createdCount || 0), 0),
      skippedTotal: recent.reduce((acc, item) => acc + (item.skippedCount || 0), 0)
    }
  })()
  const kpi = summary7d || localKpi

  const refreshData = useCallback(
    async (background = false) => {
      if (isFetchingRef.current) return
      isFetchingRef.current = true
      if (background) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      try {
        const [historyRes, summaryRes] = await Promise.all([
          fetch(`/api/teams/${teamId}/starter-files/history`),
          fetch(`/api/teams/${teamId}/starter-files/summary`)
        ])
        const payload = await historyRes.json().catch(() => ({}))
        if (!historyRes.ok) {
          throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch team starter history"))
        }
        setHistory(Array.isArray(payload?.history) ? payload.history : [])
        if (summaryRes.ok) {
          const summaryPayload = await summaryRes.json()
          setSummary7d(summaryPayload?.summary7d || null)
        } else {
          setSummary7d(null)
        }
        setLastUpdatedAt(new Date().toISOString())
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch team starter history")
        if (!background) {
          setHistory([])
          setSummary7d(null)
        }
      } finally {
        isFetchingRef.current = false
        if (background) {
          setRefreshing(false)
        } else {
          setLoading(false)
        }
      }
    },
    [teamId]
  )

  useEffect(() => {
    const onRolloutUpdated = () => {
      refreshData(true).catch(() => undefined)
    }

    refreshData().catch(() => undefined)
    window.addEventListener(`team-rollout-updated:${teamId}`, onRolloutUpdated)
    return () => {
      window.removeEventListener(`team-rollout-updated:${teamId}`, onRolloutUpdated)
    }
  }, [teamId, refreshData])

  const copyMarkdown = async () => {
    setCopying(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/starter-files/history?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export markdown"))
      }
      const text = await response.text()
      await navigator.clipboard.writeText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export markdown")
    } finally {
      setCopying(false)
    }
  }

  const downloadMarkdown = async () => {
    setDownloading(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/starter-files/history?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export markdown"))
      }
      const text = await response.text()
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `team-starter-rollout-history-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export markdown")
    } finally {
      setDownloading(false)
    }
  }

  const copySummaryMarkdown = async () => {
    setCopyingSummary(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/starter-files/summary?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export summary markdown"))
      }
      const text = await response.text()
      await navigator.clipboard.writeText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export summary markdown")
    } finally {
      setCopyingSummary(false)
    }
  }

  const downloadSummaryMarkdown = async () => {
    setDownloadingSummary(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/starter-files/summary?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export summary markdown"))
      }
      const text = await response.text()
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `team-starter-rollout-summary-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export summary markdown")
    } finally {
      setDownloadingSummary(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Team Starter Rollout History</h2>
          <button
            type="button"
            onClick={() => refreshData().catch(() => undefined)}
            disabled={loading || refreshing}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {loading || refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="text-xs text-gray-500">Recent starter-pack and template rollout records across this team.</p>
        {lastUpdatedAt && (
          <p className="mt-1 text-[11px] text-gray-500">
            Last updated: {new Date(lastUpdatedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={copyMarkdown}
          disabled={copying || loading}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {copying ? "Copying..." : "Copy Markdown"}
        </button>
        <button
          type="button"
          onClick={downloadMarkdown}
          disabled={downloading || loading}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {downloading ? "Downloading..." : "Download .md"}
        </button>
        <button
          type="button"
          onClick={copySummaryMarkdown}
          disabled={copyingSummary || loading}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {copyingSummary ? "Copying..." : "Copy Summary"}
        </button>
        <button
          type="button"
          onClick={downloadSummaryMarkdown}
          disabled={downloadingSummary || loading}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {downloadingSummary ? "Downloading..." : "Download Summary"}
        </button>
      </div>

      {loading && <div className="text-xs text-gray-500">Loading history...</div>}
      {!loading && error && history.length > 0 && (
        <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}
      {!loading && error && history.length === 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      {!loading && !error && history.length === 0 && (
        <div className="text-xs text-gray-500">No team starter-pack runs yet.</div>
      )}

      {!loading && !error && (summary7d || history.length > 0) && (
        <div className="mb-3 rounded border border-gray-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold text-gray-700">Rollout KPI (Last 7 Days)</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Runs</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.runs}</div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Pack Runs</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.packRuns}</div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Template Runs</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.templateRuns}</div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Created</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.createdTotal}</div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Skipped</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.skippedTotal}</div>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
              <div className="text-[10px] text-gray-500">Dry Runs</div>
              <div className="text-sm font-semibold text-gray-900">{kpi.dryRuns}</div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTypeFilter("ALL")}
              className={`rounded px-2 py-1 text-xs ${
                typeFilter === "ALL"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("PACK")}
              className={`rounded px-2 py-1 text-xs ${
                typeFilter === "PACK"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              Starter Pack
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("TEMPLATE")}
              className={`rounded px-2 py-1 text-xs ${
                typeFilter === "TEMPLATE"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              Template Rollout
            </button>
          </div>
          <div className="space-y-1">
          {history
            .filter((item) => {
              if (typeFilter === "PACK") return item.artifactType === "PACK"
              if (typeFilter === "TEMPLATE") return item.artifactType === "TEMPLATE"
              return true
            })
            .slice(0, 10)
            .map((item, index) => (
            <div key={`${item.createdAt}-${index}`} className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
              <span className="mr-1 rounded bg-gray-200 px-1 py-0.5 text-[10px] text-gray-700">{item.artifactType}</span>
              {new Date(item.createdAt).toLocaleString()} · {item.projectName || item.projectId || "Project"} · {item.packName || item.packId || item.templateName || item.templateId || "Artifact"} ·{" "}
              {item.templateCategory ? `(${item.templateCategory}) · ` : ""}
              {item.dryRun
                ? `dry-run, wouldCreate=${item.wouldCreateCount}`
                : `created=${item.createdCount}`} · skipped={item.skippedCount}
              {item.actor && (
                <span className="text-gray-500"> · by {item.actor.name || item.actor.email}</span>
              )}
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}
