"use client"

import { useMemo, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface ProjectItem {
  id: string
  name: string
}

interface TeamTemplateRolloutButtonProps {
  teamId: string
  templateId: string
  templateName: string
  projects: ProjectItem[]
  onCompleted?: () => void
}

export function TeamTemplateRolloutButton({
  teamId,
  templateId,
  templateName,
  projects,
  onCompleted
}: TeamTemplateRolloutButtonProps) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    projects.map((project) => project.id)
  )
  const [error, setError] = useState("")
  const [summary, setSummary] = useState<string>("")
  const [copying, setCopying] = useState(false)
  const [results, setResults] = useState<
    Array<{
      projectId: string
      ok: boolean
      createdCount: number
      wouldCreateCount: number
      skippedCount: number
      message: string
    }>
  >([])

  const allSelected = useMemo(
    () => selectedProjectIds.length === projects.length && projects.length > 0,
    [projects.length, selectedProjectIds.length]
  )
  const failedProjectIds = useMemo(
    () => results.filter((item) => !item.ok).map((item) => item.projectId),
    [results]
  )
  const successCount = useMemo(() => results.filter((item) => item.ok).length, [results])

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedProjectIds(projects.map((project) => project.id))
      return
    }
    setSelectedProjectIds([])
  }

  const buildMarkdownReport = () => {
    const lines: string[] = []
    lines.push("# Team Template Rollout Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Template: ${templateName}`)
    lines.push(`- Dry Run: ${dryRun ? "true" : "false"}`)
    lines.push(`- Total: ${results.length}`)
    lines.push(`- Success: ${successCount}`)
    lines.push(`- Failed: ${failedProjectIds.length}`)
    lines.push("")
    lines.push("| Project | Status | Result |")
    lines.push("| --- | --- | --- |")
    for (const item of results) {
      const projectName = projects.find((project) => project.id === item.projectId)?.name || item.projectId
      const resultText = item.ok
        ? dryRun
          ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
          : `created=${item.createdCount}, skipped=${item.skippedCount}`
        : item.message
      lines.push(`| ${projectName.replace(/\|/g, "\\|")} | ${item.ok ? "OK" : "FAILED"} | ${resultText.replace(/\|/g, "\\|")} |`)
    }
    return lines.join("\n")
  }

  const copyReport = async () => {
    if (results.length === 0) return
    setCopying(true)
    setError("")
    try {
      await navigator.clipboard.writeText(buildMarkdownReport())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy rollout report")
    } finally {
      setCopying(false)
    }
  }

  const runRolloutFor = async (projectIds: string[]) => {
    if (projectIds.length === 0) {
      setError("Select at least one project.")
      return
    }
    setRunning(true)
    setError("")
    setSummary("")
    setResults([])
    try {
      const response = await fetchWithTimeoutRetry(
        `/api/teams/${teamId}/starter-files/apply-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId,
            projectIds,
            skipExistingByTemplateType: true,
            dryRun
          })
        },
        {
          timeoutMs: 10000,
          maxRetries: 2,
          retryDelayMs: 300
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to roll out template"))
      }
      setResults(Array.isArray(payload.results) ? payload.results : [])
      setSummary(
        `Completed ${payload.total} project(s): success ${payload.successCount}, failed ${payload.failedCount}.`
      )
      onCompleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to roll out template")
    } finally {
      setRunning(false)
    }
  }

  const runRollout = async () => {
    await runRolloutFor(selectedProjectIds)
  }

  const retryFailed = async () => {
    if (failedProjectIds.length === 0) return
    await runRolloutFor(failedProjectIds)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={projects.length === 0}
        title={projects.length === 0 ? "No projects available in this team" : `Roll out ${templateName} to team projects`}
        className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        Roll Out to Team
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 p-4">
              <h3 className="text-lg font-semibold text-gray-900">Template Team Rollout</h3>
              <p className="mt-1 text-sm text-gray-500">{templateName}</p>
            </div>
            <div className="space-y-3 p-4">
              {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              {summary && (
                <div className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">{summary}</div>
              )}
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  disabled={running}
                />
                Dry run
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={running}
                />
                Select all projects
              </label>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(project.id)}
                      onChange={(e) => toggleProject(project.id, e.target.checked)}
                      disabled={running}
                    />
                    <span>{project.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setError("")
                  setSummary("")
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                disabled={running}
              >
                Close
              </button>
              <button
                type="button"
                onClick={runRollout}
                disabled={running || selectedProjectIds.length === 0}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {running ? "Running..." : dryRun ? "Preview Rollout" : "Run Rollout"}
              </button>
              <button
                type="button"
                onClick={retryFailed}
                disabled={running || failedProjectIds.length === 0}
                className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                Retry Failed ({failedProjectIds.length})
              </button>
              <button
                type="button"
                onClick={copyReport}
                disabled={copying || results.length === 0}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {copying ? "Copying..." : "Copy Report"}
              </button>
            </div>
            {results.length > 0 && (
              <div className="border-t border-gray-200 px-4 py-3">
                <div className="mb-2 text-xs text-gray-700">
                  Completed {results.length} project(s) · Success {successCount} · Failed {failedProjectIds.length}
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {results.map((item) => (
                    <div key={item.projectId} className="text-xs text-gray-600">
                      {(projects.find((project) => project.id === item.projectId)?.name || item.projectId)}:{" "}
                      {item.ok
                        ? dryRun
                          ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
                          : `created=${item.createdCount}, skipped=${item.skippedCount}`
                        : item.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
