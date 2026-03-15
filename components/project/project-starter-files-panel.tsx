"use client"

import { useCallback, useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchStarterPackOptionsCached } from "@/lib/reports/starter-pack-options-cache"
import { fetchTemplateOptionsCached } from "@/lib/reports/template-options-cache"

type StarterPack = {
  id: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
  name: string
  description: string
  templateIds: string[]
}

type BuiltInTemplate = {
  id: string
  name: string
  category: string
}

interface ProjectStarterFilesPanelProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
}

type StarterHistoryItem = {
  createdAt: string
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

export function ProjectStarterFilesPanel({
  projectId,
  currentUserRole
}: ProjectStarterFilesPanelProps) {
  const [packs, setPacks] = useState<StarterPack[]>([])
  const [templates, setTemplates] = useState<BuiltInTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [runningPackId, setRunningPackId] = useState<string | null>(null)
  const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [history, setHistory] = useState<StarterHistoryItem[]>([])
  const [typeFilter, setTypeFilter] = useState<"ALL" | "PACK" | "TEMPLATE">("ALL")
  const [copying, setCopying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copyingSummary, setCopyingSummary] = useState(false)
  const [downloadingSummary, setDownloadingSummary] = useState(false)
  const [savingHistory, setSavingHistory] = useState(false)
  const [savingSummary, setSavingSummary] = useState(false)
  const [summary7d, setSummary7d] = useState<RolloutSummary | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"
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

  const refreshHistoryAndSummary = useCallback(async () => {
    const [historyRes, summaryRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/starter-files/history`),
      fetch(`/api/projects/${projectId}/starter-files/summary`)
    ])
    if (!historyRes.ok) {
      const body = await historyRes.json().catch(() => ({}))
      throw new Error(mapReportApiErrorFromPayload(body, "Failed to load starter history"))
    }
    const historyPayload = await historyRes.json()
    setHistory(Array.isArray(historyPayload?.history) ? historyPayload.history : [])

    if (summaryRes.ok) {
      const summaryPayload = await summaryRes.json()
      setSummary7d(summaryPayload?.summary7d || null)
    } else {
      setSummary7d(null)
    }
  }, [projectId])

  const loadCatalog = useCallback(async () => {
    const [packsPayload, templatesPayload] = await Promise.all([
      fetchStarterPackOptionsCached(),
      fetchTemplateOptionsCached({ visibility: "BUILT_IN" })
    ])
    setPacks(Array.isArray(packsPayload) ? packsPayload : [])
    const builtInTemplates = Array.isArray(templatesPayload)
      ? templatesPayload.map((item: { id: string; name: string; category: string }) => ({
          id: item.id,
          name: item.name,
          category: item.category
        }))
      : []
    setTemplates(builtInTemplates)
    if (builtInTemplates.length > 0) {
      setSelectedTemplateId((prev) => prev || builtInTemplates[0].id)
    }
  }, [])

  const refreshPanel = useCallback(
    async (background = false) => {
      if (background) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)
      try {
        await Promise.all([loadCatalog(), refreshHistoryAndSummary()])
        setLastUpdatedAt(new Date().toISOString())
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load starter packs")
        if (!background) {
          setPacks([])
          setTemplates([])
          setHistory([])
          setSummary7d(null)
        }
      } finally {
        if (background) {
          setRefreshing(false)
        } else {
          setLoading(false)
        }
      }
    },
    [loadCatalog, refreshHistoryAndSummary]
  )

  useEffect(() => {
    refreshPanel().catch(() => undefined)
  }, [refreshPanel])

  const applyPack = async (pack: StarterPack) => {
    if (!canEdit) return
    setRunningPackId(pack.id)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/apply-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: pack.id,
          skipExistingByTemplateType: true
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to apply starter pack"))
      }
      setInfo(
        `Applied ${pack.name}: created ${payload.createdCount || 0}, skipped ${payload.skippedCount || 0}.`
      )
      await refreshHistoryAndSummary()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply starter pack")
    } finally {
      setRunningPackId(null)
    }
  }

  const applyTemplate = async (dryRun: boolean) => {
    if (!canEdit || !selectedTemplateId) return
    setRunningTemplateId(selectedTemplateId)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          skipExistingByTemplateType: true,
          dryRun
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to apply template"))
      }
      const templateName =
        templates.find((item) => item.id === selectedTemplateId)?.name || payload?.templateName || "Template"
      if (dryRun) {
        setInfo(
          `Preview ${templateName}: wouldCreate ${payload.wouldCreateCount || 0}, skipped ${payload.skippedCount || 0}.`
        )
      } else {
        setInfo(
          `Applied ${templateName}: created ${payload.createdCount || 0}, skipped ${payload.skippedCount || 0}.`
        )
      }
      await refreshHistoryAndSummary()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply template")
    } finally {
      setRunningTemplateId(null)
    }
  }

  const copyMarkdown = async () => {
    setCopying(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/history?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export markdown"))
      }
      const text = await response.text()
      await navigator.clipboard.writeText(text)
      setInfo("Starter rollout markdown copied.")
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
      const response = await fetch(`/api/projects/${projectId}/starter-files/history?format=markdown`)
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
      anchor.download = `project-starter-rollout-history-${stamp}.md`
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
      const response = await fetch(`/api/projects/${projectId}/starter-files/summary?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export summary markdown"))
      }
      const text = await response.text()
      await navigator.clipboard.writeText(text)
      setInfo("Starter rollout summary markdown copied.")
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
      const response = await fetch(`/api/projects/${projectId}/starter-files/summary?format=markdown`)
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
      anchor.download = `project-starter-rollout-summary-${stamp}.md`
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

  const saveHistoryAsFile = async () => {
    if (!canEdit) return
    setSavingHistory(true)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch("/api/projects/starter-files/history/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: projectId,
          targetProjectId: projectId
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save rollout history"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setInfo("Rollout history saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rollout history")
    } finally {
      setSavingHistory(false)
    }
  }

  const saveSummaryAsFile = async () => {
    if (!canEdit) return
    setSavingSummary(true)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/summary/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save rollout summary"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setInfo("Rollout summary saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rollout summary")
    } finally {
      setSavingSummary(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Starter Files</h2>
        <button
          type="button"
          onClick={() => refreshPanel(true).catch(() => undefined)}
          disabled={loading || refreshing}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {loading || refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="mb-3 text-sm text-gray-600">
        Apply a built-in starter pack to bootstrap this project with standard markdown files.
      </p>
      {lastUpdatedAt && (
        <p className="mb-2 text-[11px] text-gray-500">
          Last updated: {new Date(lastUpdatedAt).toLocaleString()}
        </p>
      )}

      {error && history.length > 0 && !loading && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}
      {error && history.length === 0 && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {info && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{info}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading starter packs...</div>
      ) : packs.length === 0 ? (
        <div className="text-sm text-gray-500">No starter packs available.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {packs.map((pack) => (
            <div key={pack.id} className="rounded border border-gray-200 p-3">
              <div className="text-sm font-semibold text-gray-900">{pack.name}</div>
              <div className="mt-1 text-xs text-gray-600">{pack.description}</div>
              <div className="mt-2 text-xs text-gray-500">{pack.templateIds.length} template(s)</div>
              <button
                type="button"
                onClick={() => applyPack(pack)}
                disabled={!canEdit || runningPackId === pack.id}
                className="mt-3 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {runningPackId === pack.id ? "Applying..." : `Apply ${pack.name}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {templates.length > 0 && (
        <div className="mt-4 rounded border border-gray-200 p-3">
          <div className="text-sm font-semibold text-gray-900">Single Template Rollout</div>
          <div className="mt-1 text-xs text-gray-600">
            Apply one built-in template to this project (with optional dry-run preview).
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              disabled={!canEdit || Boolean(runningTemplateId)}
              className="min-w-[240px] rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.category})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => applyTemplate(true)}
              disabled={!canEdit || !selectedTemplateId || Boolean(runningTemplateId)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {runningTemplateId ? "Running..." : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => applyTemplate(false)}
              disabled={!canEdit || !selectedTemplateId || Boolean(runningTemplateId)}
              className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {runningTemplateId ? "Applying..." : "Apply Template"}
            </button>
          </div>
        </div>
      )}

      {(summary7d || history.length > 0) && (
        <div className="mt-4 rounded border border-gray-200 bg-white p-3">
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

      {history.length > 0 && (
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">Recent Runs</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveHistoryAsFile}
                disabled={!canEdit || savingHistory}
                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {savingHistory ? "Saving..." : "Save as File"}
              </button>
              <button
                type="button"
                onClick={saveSummaryAsFile}
                disabled={!canEdit || savingSummary}
                className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {savingSummary ? "Saving..." : "Save Summary"}
              </button>
              <button
                type="button"
                onClick={copyMarkdown}
                disabled={copying}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {copying ? "Copying..." : "Copy Markdown"}
              </button>
              <button
                type="button"
                onClick={downloadMarkdown}
                disabled={downloading}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {downloading ? "Downloading..." : "Download .md"}
              </button>
              <button
                type="button"
                onClick={copySummaryMarkdown}
                disabled={copyingSummary}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {copyingSummary ? "Copying..." : "Copy Summary"}
              </button>
              <button
                type="button"
                onClick={downloadSummaryMarkdown}
                disabled={downloadingSummary}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {downloadingSummary ? "Downloading..." : "Download Summary"}
              </button>
            </div>
          </div>
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
              .slice(0, 6)
              .map((item, index) => (
              <div key={`${item.createdAt}-${index}`} className="text-xs text-gray-600">
                <span className="mr-1 rounded bg-gray-200 px-1 py-0.5 text-[10px] text-gray-700">{item.artifactType}</span>
                {new Date(item.createdAt).toLocaleString()} · {item.packName || item.packId || item.templateName || item.templateId || "Artifact"} ·
                {" "}
                {item.templateCategory ? `(${item.templateCategory}) · ` : ""}
                {item.dryRun
                  ? `dry-run, wouldCreate=${item.wouldCreateCount}`
                  : `created=${item.createdCount}`} · skipped={item.skippedCount}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
