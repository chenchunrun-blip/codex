"use client"

import { useEffect, useMemo, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface ProjectItem {
  id: string
  name: string
}
interface ArchiveFileItem {
  projectId: string
  projectName: string
  fileId: string
  fileName: string
}

interface ProjectBulkStarterPackPanelProps {
  projects: ProjectItem[]
  title?: string
  description?: string
  historyKey?: string
  endpoint?: string
  onCompleted?: () => void
}

const BULK_STARTER_PACK_HISTORY_KEY = "bulk-starter-pack-runner-history-v1"
const REQUEST_OPTIONS = { timeoutMs: 10000, maxRetries: 2, retryDelayMs: 300 }

export function ProjectBulkStarterPackPanel({
  projects,
  title = "Bulk Starter Pack Runner",
  description = "Apply PM/IT/Ops starter pack to multiple projects in one run",
  historyKey = BULK_STARTER_PACK_HISTORY_KEY,
  endpoint = "/api/projects/starter-files/bulk-apply-pack",
  onCompleted
}: ProjectBulkStarterPackPanelProps) {
  const [packId, setPackId] = useState<"PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER">("PM_STARTER")
  const [dryRun, setDryRun] = useState(true)
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(projects.map((project) => project.id))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyingReport, setCopyingReport] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historySavedAt, setHistorySavedAt] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFileItem[]>([])
  const [results, setResults] = useState<Array<{
    projectId: string
    ok: boolean
    createdCount: number
    wouldCreateCount?: number
    skippedCount: number
    message: string
  }>>([])

  const summary = useMemo(() => {
    const success = results.filter((item) => item.ok).length
    const failed = results.filter((item) => !item.ok).length
    return { success, failed, total: results.length }
  }, [results])
  const failedProjectIds = useMemo(
    () => results.filter((item) => !item.ok).map((item) => item.projectId),
    [results]
  )

  const buildMarkdownReport = () => {
    const lines: string[] = []
    lines.push("# Bulk Starter Pack Runner Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Pack: ${packId}`)
    lines.push(`- Dry Run: ${dryRun ? "true" : "false"}`)
    lines.push(`- Completed: ${summary.total}`)
    lines.push(`- Success: ${summary.success}`)
    lines.push(`- Failed: ${summary.failed}`)
    lines.push("")
    lines.push("| Project | Status | Result |")
    lines.push("| --- | --- | --- |")
    for (const item of results) {
      const projectName = projects.find((project) => project.id === item.projectId)?.name || item.projectId
      const status = item.ok ? "OK" : "FAILED"
      const resultText = item.ok
        ? dryRun
          ? `wouldCreate=${item.wouldCreateCount || 0}, skipped=${item.skippedCount}`
          : `created=${item.createdCount}, skipped=${item.skippedCount}`
        : item.message
      lines.push(`| ${projectName} | ${status} | ${resultText.replace(/\|/g, "\\|")} |`)
    }
    return lines.join("\n")
  }

  const buildProjectMarkdownReport = (projectId: string) => {
    const rows = results.filter((item) => item.projectId === projectId)
    const projectName = projects.find((project) => project.id === projectId)?.name || "Project"
    const lines: string[] = []
    lines.push("# Bulk Starter Pack Runner Report")
    lines.push("")
    lines.push(`- Project: ${projectName}`)
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Pack: ${packId}`)
    lines.push(`- Dry Run: ${dryRun ? "true" : "false"}`)
    lines.push(`- Rows: ${rows.length}`)
    lines.push("")
    lines.push("| Status | Result |")
    lines.push("| --- | --- |")
    for (const row of rows) {
      const resultText = row.ok
        ? dryRun
          ? `wouldCreate=${row.wouldCreateCount || 0}, skipped=${row.skippedCount}`
          : `created=${row.createdCount}, skipped=${row.skippedCount}`
        : row.message
      lines.push(`| ${row.ok ? "OK" : "FAILED"} | ${resultText.replace(/\|/g, "\\|")} |`)
    }
    return lines.join("\n")
  }

  const persistHistory = (nextResults: typeof results) => {
    try {
      localStorage.setItem(
        historyKey,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          packId,
          dryRun,
          results: nextResults
        })
      )
      setHistorySavedAt(new Date().toISOString())
    } catch {
      // ignore storage failures
    }
  }

  useEffect(() => {
    if (historyLoaded) return
    try {
      const raw = localStorage.getItem(historyKey)
      if (!raw) {
        setHistoryLoaded(true)
        return
      }
      const parsed = JSON.parse(raw) as {
        savedAt?: string
        packId?: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
        dryRun?: boolean
        results?: typeof results
      }
      if (typeof parsed.savedAt === "string") setHistorySavedAt(parsed.savedAt)
      if (parsed.packId) setPackId(parsed.packId)
      if (typeof parsed.dryRun === "boolean") setDryRun(parsed.dryRun)
      if (Array.isArray(parsed.results)) setResults(parsed.results)
    } catch {
      // ignore parse errors
    } finally {
      setHistoryLoaded(true)
    }
  }, [historyLoaded, historyKey])

  const clearHistory = () => {
    try {
      localStorage.removeItem(historyKey)
    } catch {
      // ignore storage failures
    }
    setResults([])
    setHistorySavedAt(null)
  }

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const runBulkApplyFor = async (projectIds: string[]) => {
    if (projectIds.length === 0) return
    setRunning(true)
    setError(null)
    setResults([])
    setArchiveFiles([])
    try {
      const response = await fetchWithTimeoutRetry(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packId,
            projectIds,
            skipExistingByTemplateType: true,
            dryRun
          })
        },
        REQUEST_OPTIONS
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to run bulk starter-pack apply"))
      }
      const nextResults = Array.isArray(payload?.results) ? payload.results : []
      setResults(nextResults)
      persistHistory(nextResults)
      onCompleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run bulk starter-pack apply")
    } finally {
      setRunning(false)
    }
  }

  const runBulkApply = async () => {
    await runBulkApplyFor(selectedProjectIds)
  }

  const retryFailedProjects = async () => {
    await runBulkApplyFor(failedProjectIds)
  }

  const copyMarkdownReport = async () => {
    if (results.length === 0) return
    setCopyingReport(true)
    try {
      await navigator.clipboard.writeText(buildMarkdownReport())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy report")
    } finally {
      setCopyingReport(false)
    }
  }

  const downloadMarkdownReport = () => {
    if (results.length === 0) return
    const content = buildMarkdownReport()
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `bulk-starter-pack-report-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const archiveReports = async () => {
    if (results.length === 0) return
    setIsArchiving(true)
    setError(null)
    setArchiveFiles([])
    try {
      const byProject = new Set(results.map((item) => item.projectId))
      const created: ArchiveFileItem[] = []
      for (const projectId of byProject) {
        const projectName = projects.find((project) => project.id === projectId)?.name || "project"
        const safeProject = projectName
          .trim()
          .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const fileName = `${safeProject}-bulk-starter-pack-report-${stamp}.md`
        const content = buildProjectMarkdownReport(projectId)
        const response = await fetchWithTimeoutRetry(
          "/api/projects/bulk-run-report/save",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              reportType: "PROJECT_BULK_STARTER_PACK_REPORT_SAVED",
              content,
              fileName
            })
          },
          REQUEST_OPTIONS
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(mapReportApiErrorFromPayload(payload, `Failed to archive report for ${projectName}`))
        }
        created.push({
          projectId,
          projectName,
          fileId: payload.file.id,
          fileName: payload.file.name
        })
      }
      setArchiveFiles(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive starter-pack reports")
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500">{description}</p>
        {historySavedAt && (
          <p className="mt-1 text-[11px] text-gray-400">
            Last snapshot: {new Date(historySavedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          Pack
          <select
            value={packId}
            onChange={(e) =>
              setPackId(e.target.value as "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER")
            }
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="PM_STARTER">PM Starter</option>
            <option value="IT_RD_STARTER">IT R&D Starter</option>
            <option value="OPS_INCIDENT_STARTER">Ops Incident Starter</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry Run
        </label>
        <button
          type="button"
          onClick={runBulkApply}
          disabled={running || selectedProjectIds.length === 0}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? "Applying..." : `${dryRun ? "Preview" : "Apply"} to ${selectedProjectIds.length} Project(s)`}
        </button>
        <button
          type="button"
          onClick={retryFailedProjects}
          disabled={running || failedProjectIds.length === 0}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Retry Failed ({failedProjectIds.length})
        </button>
        <button
          type="button"
          onClick={copyMarkdownReport}
          disabled={copyingReport || results.length === 0}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {copyingReport ? "Copying..." : "Copy Report"}
        </button>
        <button
          type="button"
          onClick={downloadMarkdownReport}
          disabled={results.length === 0}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Download .md
        </button>
        <button
          type="button"
          onClick={archiveReports}
          disabled={isArchiving || results.length === 0}
          className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {isArchiving ? "Archiving..." : "Archive Reports"}
        </button>
        <button
          type="button"
          onClick={clearHistory}
          disabled={results.length === 0 && !historySavedAt}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Clear Snapshot
        </button>
      </div>

      <div className="max-h-40 overflow-y-auto rounded border border-gray-200 p-2">
        {projects.map((project) => (
          <label key={project.id} className="flex items-center gap-2 px-1 py-1 text-xs text-gray-700 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selectedProjectIds.includes(project.id)}
              onChange={(e) => toggleProject(project.id, e.target.checked)}
            />
            <span>{project.name}</span>
          </label>
        ))}
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {results.length > 0 && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs text-gray-700">
            Completed {summary.total} · Success {summary.success} · Failed {summary.failed}
          </div>
          <div className="space-y-1">
            {results.map((item) => (
              <div key={item.projectId} className="text-xs text-gray-600">
                {(projects.find((project) => project.id === item.projectId)?.name || item.projectId)}: {item.ok
                  ? dryRun
                    ? `wouldCreate=${item.wouldCreateCount || 0}, skipped=${item.skippedCount}`
                    : `created=${item.createdCount}, skipped=${item.skippedCount}`
                  : item.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {archiveFiles.length > 0 && (
        <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2">
          <div className="mb-1 text-xs font-medium text-blue-800">Archived Reports</div>
          <div className="space-y-1 text-xs">
            {archiveFiles.map((file) => (
              <div key={file.fileId} className="text-blue-700">
                [{file.projectName}]{" "}
                <a href={`/editor/${file.fileId}`} className="underline hover:text-blue-900">
                  {file.fileName}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
