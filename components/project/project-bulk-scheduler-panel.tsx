"use client"

import { useEffect, useMemo, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface ProjectItem {
  id: string
  name: string
  policySource: "project" | "default"
}

interface ProjectBulkSchedulerPanelProps {
  projects: ProjectItem[]
}

interface BulkResultItem {
  projectId: string
  projectName: string
  ok: boolean
  total?: number
  successCount?: number
  failedCount?: number
  message: string
}

interface ArchiveFileItem {
  projectId: string
  projectName: string
  fileId: string
  fileName: string
}

const BULK_RUNNER_HISTORY_KEY = "bulk-scheduler-runner-history-v1"
const REQUEST_OPTIONS = { timeoutMs: 10000, maxRetries: 2, retryDelayMs: 300 }

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  runner: (item: T) => Promise<void>
) {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      await runner(next)
    }
  })
  await Promise.all(workers)
}

export function ProjectBulkSchedulerPanel({ projects }: ProjectBulkSchedulerPanelProps) {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(projects.map((p) => p.id))
  const [scopeFilter, setScopeFilter] = useState<"ALL" | "CUSTOM" | "DEFAULT">("ALL")
  const [limitPerProject, setLimitPerProject] = useState(3)
  const [autoSubmit, setAutoSubmit] = useState(true)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BulkResultItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copyingReport, setCopyingReport] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFileItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historySavedAt, setHistorySavedAt] = useState<string | null>(null)

  const visibleProjects = useMemo(() => {
    if (scopeFilter === "CUSTOM") {
      return projects.filter((project) => project.policySource === "project")
    }
    if (scopeFilter === "DEFAULT") {
      return projects.filter((project) => project.policySource === "default")
    }
    return projects
  }, [projects, scopeFilter])

  const selectedCount = selectedProjectIds.length
  const visibleSelectedCount = visibleProjects.filter((project) => selectedProjectIds.includes(project.id)).length
  const allVisibleSelected = visibleProjects.length > 0 && visibleSelectedCount === visibleProjects.length

  const summary = useMemo(() => {
    const success = results.filter((item) => item.ok).length
    const failed = results.filter((item) => !item.ok).length
    return { success, failed, total: results.length }
  }, [results])
  const failedProjectIdsFromLastRun = useMemo(
    () => results.filter((item) => !item.ok).map((item) => item.projectId),
    [results]
  )

  const buildMarkdownReport = () => {
    const timestamp = new Date().toISOString()
    const lines: string[] = []
    lines.push("# Bulk Scheduler Runner Report")
    lines.push("")
    lines.push(`- Generated At: ${timestamp}`)
    lines.push(`- Selected Projects: ${selectedCount}`)
    lines.push(`- Completed: ${summary.total}`)
    lines.push(`- Success: ${summary.success}`)
    lines.push(`- Failed: ${summary.failed}`)
    lines.push(`- Task Limit / Project: ${limitPerProject}`)
    lines.push(`- Auto-submit: ${autoSubmit ? "true" : "false"}`)
    lines.push("")
    lines.push("## Result Rows")
    lines.push("")
    lines.push("| Project | Status | Summary |")
    lines.push("| --- | --- | --- |")
    for (const item of results) {
      const status = item.ok ? "OK" : "FAILED"
      const summaryText = item.ok
        ? `tasks=${item.total}, success=${item.successCount}, failed=${item.failedCount}, note=${item.message}`
        : item.message
      lines.push(`| ${item.projectName} | ${status} | ${summaryText.replace(/\|/g, "\\|")} |`)
    }
    return lines.join("\n")
  }

  const buildProjectMarkdownReport = (projectId: string) => {
    const projectRows = results.filter((item) => item.projectId === projectId)
    const projectName = projectRows[0]?.projectName || "Project"
    const timestamp = new Date().toISOString()
    const lines: string[] = []
    lines.push("# Project Scheduler Report")
    lines.push("")
    lines.push(`- Project: ${projectName}`)
    lines.push(`- Generated At: ${timestamp}`)
    lines.push(`- Rows: ${projectRows.length}`)
    lines.push("")
    lines.push("| Status | Summary |")
    lines.push("| --- | --- |")
    for (const row of projectRows) {
      const status = row.ok ? "OK" : "FAILED"
      const summaryText = row.ok
        ? `tasks=${row.total}, success=${row.successCount}, failed=${row.failedCount}, note=${row.message}`
        : row.message
      lines.push(`| ${status} | ${summaryText.replace(/\|/g, "\\|")} |`)
    }
    return lines.join("\n")
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
    anchor.download = `bulk-scheduler-report-${stamp}.md`
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
      const byProject = new Map<string, BulkResultItem[]>()
      for (const item of results) {
        if (!byProject.has(item.projectId)) byProject.set(item.projectId, [])
        byProject.get(item.projectId)!.push(item)
      }

      const created: ArchiveFileItem[] = []
      for (const [projectId, rows] of byProject.entries()) {
        const projectName = rows[0]?.projectName || "project"
        const safeProject = projectName
          .trim()
          .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const fileName = `${safeProject}-bulk-scheduler-report-${stamp}`
        const content = buildProjectMarkdownReport(projectId)

        const response = await fetchWithTimeoutRetry(
          "/api/projects/bulk-run-report/save",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              reportType: "PROJECT_BULK_SCHEDULER_REPORT_SAVED",
              fileName,
              content
            })
          },
          REQUEST_OPTIONS
        )
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(mapReportApiErrorFromPayload(data, `Failed to archive report for ${projectName}`))
        }
        const data = await response.json()
        created.push({
          projectId,
          projectName,
          fileId: data.file.id,
          fileName: data.file.name
        })
      }
      setArchiveFiles(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive reports")
    } finally {
      setIsArchiving(false)
    }
  }

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const persistHistory = (nextResults: BulkResultItem[]) => {
    try {
      const savedAt = new Date().toISOString()
      const payload = {
        savedAt,
        results: nextResults
      }
      localStorage.setItem(BULK_RUNNER_HISTORY_KEY, JSON.stringify(payload))
      setHistorySavedAt(savedAt)
    } catch {
      // ignore storage failures
    }
  }

  const clearHistory = () => {
    try {
      localStorage.removeItem(BULK_RUNNER_HISTORY_KEY)
    } catch {
      // ignore storage failures
    }
    setResults([])
    setArchiveFiles([])
    setHistorySavedAt(null)
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedProjectIds(checked ? projects.map((p) => p.id) : [])
  }

  const selectVisible = (checked: boolean) => {
    if (checked) {
      setSelectedProjectIds((prev) =>
        Array.from(new Set([...prev, ...visibleProjects.map((project) => project.id)]))
      )
      return
    }
    const visibleIds = new Set(visibleProjects.map((project) => project.id))
    setSelectedProjectIds((prev) => prev.filter((id) => !visibleIds.has(id)))
  }

  const runForProjectIds = async (projectIdsToRun: string[]) => {
    if (projectIdsToRun.length === 0) return
    setRunning(true)
    setError(null)
    setResults([])

    const nextResults: BulkResultItem[] = []
    const selectedProjects = projects.filter((project) => projectIdsToRun.includes(project.id))

    try {
      await runWithConcurrency(selectedProjects, 4, async (project) => {
        const idempotencyKey = `bulk-${project.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        try {
          const response = await fetchWithTimeoutRetry(
            "/api/tasks/scheduler/trigger",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: project.id,
                limit: limitPerProject,
                autoSubmit,
                idempotencyKey
              })
            },
            REQUEST_OPTIONS
          )
          const data = await response.json().catch(() => ({}))
          if (!response.ok) {
            nextResults.push({
              projectId: project.id,
              projectName: project.name,
              ok: false,
              message: mapTaskOpsApiErrorFromPayload(data, "Scheduler trigger failed")
            })
            return
          }
          nextResults.push({
            projectId: project.id,
            projectName: project.name,
            ok: true,
            total: data?.total ?? 0,
            successCount: data?.successCount ?? 0,
            failedCount: data?.failedCount ?? 0,
            message: data?.deduplicated ? "Deduplicated" : "Triggered"
          })
        } catch (err) {
          nextResults.push({
            projectId: project.id,
            projectName: project.name,
            ok: false,
            message: err instanceof Error ? err.message : "Scheduler trigger failed"
          })
        }
        setResults([...nextResults])
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk scheduler run failed")
    } finally {
      setResults([...nextResults])
      persistHistory([...nextResults])
      setRunning(false)
    }
  }

  const runBulkScheduler = async () => {
    await runForProjectIds(selectedProjectIds)
  }

  const retryFailedProjects = async () => {
    await runForProjectIds(failedProjectIdsFromLastRun)
  }

  useEffect(() => {
    if (historyLoaded) return
    try {
      const raw = localStorage.getItem(BULK_RUNNER_HISTORY_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { savedAt?: string; results?: BulkResultItem[] }
        if (typeof parsed.savedAt === "string") {
          setHistorySavedAt(parsed.savedAt)
        }
        if (Array.isArray(parsed.results)) {
          setResults(parsed.results)
        }
      }
    } catch {
      // ignore storage parse errors
    } finally {
      setHistoryLoaded(true)
    }
  }, [historyLoaded])

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Bulk Scheduler Runner</h2>
          <p className="text-xs text-gray-500">Run project schedulers concurrently (up to 4 projects at once)</p>
          {historySavedAt && (
            <p className="mt-1 text-[11px] text-gray-400">
              Last snapshot: {new Date(historySavedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={selectedCount > 0 && selectedCount === projects.length}
            onChange={(e) => toggleSelectAll(e.target.checked)}
          />
          Select all
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          Scope
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as "ALL" | "CUSTOM" | "DEFAULT")}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="ALL">All</option>
            <option value="CUSTOM">Custom policy</option>
            <option value="DEFAULT">Default policy</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(e) => selectVisible(e.target.checked)}
          />
          Select visible ({visibleProjects.length})
        </label>
        <label className="text-xs text-gray-700">
          Task limit / project
          <input
            type="number"
            min={1}
            max={20}
            value={limitPerProject}
            onChange={(e) => setLimitPerProject(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            className="ml-2 w-16 rounded border border-gray-300 px-2 py-1 text-xs"
          />
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={autoSubmit}
            onChange={(e) => setAutoSubmit(e.target.checked)}
          />
          Auto-submit
        </label>
        <button
          onClick={runBulkScheduler}
          disabled={running || selectedCount === 0}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? "Running..." : `Run Scheduler for ${selectedCount} project(s)`}
        </button>
        <button
          onClick={retryFailedProjects}
          disabled={running || failedProjectIdsFromLastRun.length === 0}
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Retry failed projects ({failedProjectIdsFromLastRun.length})
        </button>
      </div>

      <div className="mb-3 max-h-32 overflow-auto rounded border border-gray-200 bg-gray-50 p-2">
        <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => (
            <label key={project.id} className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={selectedProjectIds.includes(project.id)}
                onChange={(e) => toggleProject(project.id, e.target.checked)}
              />
              <span>{project.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  project.policySource === "project"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {project.policySource === "project" ? "Custom" : "Default"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      {results.length > 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs text-gray-700">
              Completed: {summary.total}, Success: {summary.success}, Failed: {summary.failed}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyMarkdownReport}
                disabled={copyingReport}
                className="rounded bg-gray-200 px-2 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
              >
                {copyingReport ? "Copying..." : "Copy Report"}
              </button>
              <button
                onClick={downloadMarkdownReport}
                className="rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-gray-900"
              >
                Download .md
              </button>
              <button
                onClick={archiveReports}
                disabled={isArchiving}
                className="rounded bg-blue-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {isArchiving ? "Archiving..." : "Archive Reports"}
              </button>
              <button
                onClick={clearHistory}
                disabled={results.length === 0 && !historySavedAt}
                className="rounded bg-white px-2 py-1 text-[11px] font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                Clear Snapshot
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="px-2 py-1">Project</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={`${item.projectId}-${item.message}`} className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-700">{item.projectName}</td>
                    <td className="px-2 py-1">
                      <span className={item.ok ? "text-green-700" : "text-red-700"}>
                        {item.ok ? "OK" : "Failed"}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-gray-700">
                      {item.ok
                        ? `tasks: ${item.total}, success: ${item.successCount}, failed: ${item.failedCount} (${item.message})`
                        : item.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
