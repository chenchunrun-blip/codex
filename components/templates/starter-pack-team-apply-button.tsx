"use client"

import { useMemo, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface TeamProjectItem {
  id: string
  name: string
}

interface TeamItem {
  id: string
  name: string
  projects: TeamProjectItem[]
}

interface StarterPackTeamApplyButtonProps {
  packId: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
  packName: string
  teams: TeamItem[]
}

export function StarterPackTeamApplyButton({
  packId,
  packName,
  teams
}: StarterPackTeamApplyButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teams[0]?.id || "")
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId]
  )
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(teams[0]?.projects.map((project) => project.id) || [])
  const [result, setResult] = useState<{
    total: number
    successCount: number
    failedCount: number
    dryRun: boolean
    results: Array<{
      projectId: string
      projectName?: string
      ok: boolean
      createdCount: number
      wouldCreateCount: number
      skippedCount: number
      message: string
    }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const failedProjectIds = useMemo(
    () => (result?.results || []).filter((item) => !item.ok).map((item) => item.projectId),
    [result]
  )
  const successCount = useMemo(
    () => (result?.results || []).filter((item) => item.ok).length,
    [result]
  )

  const handleTeamChange = (teamId: string) => {
    setSelectedTeamId(teamId)
    const team = teams.find((item) => item.id === teamId)
    setSelectedProjectIds(team?.projects.map((project) => project.id) || [])
    setResult(null)
    setError(null)
  }

  const runForProjectIds = async (projectIds: string[]) => {
    if (!selectedTeamId) {
      setError("Please select a team.")
      return
    }
    if (projectIds.length === 0) {
      setError("Please select at least one project.")
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`/api/teams/${selectedTeamId}/starter-files/apply-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          projectIds,
          dryRun,
          skipExistingByTemplateType: true
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to apply starter pack to team"))
      }
      setResult({
        total: payload?.total || 0,
        successCount: payload?.successCount || 0,
        failedCount: payload?.failedCount || 0,
        dryRun: payload?.dryRun === true,
        results: Array.isArray(payload?.results) ? payload.results : []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply starter pack to team")
    } finally {
      setLoading(false)
    }
  }
  const run = async () => {
    await runForProjectIds(selectedProjectIds)
  }

  const retryFailed = async () => {
    if (failedProjectIds.length === 0) return
    await runForProjectIds(failedProjectIds)
  }

  const buildMarkdownReport = () => {
    const lines: string[] = []
    lines.push("# Team Starter Pack Quick Apply Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Starter Pack: ${packName}`)
    lines.push(`- Team: ${selectedTeam?.name || selectedTeamId || "-"}`)
    lines.push(`- Dry Run: ${dryRun ? "true" : "false"}`)
    lines.push(`- Total: ${result?.total || 0}`)
    lines.push(`- Success: ${successCount}`)
    lines.push(`- Failed: ${failedProjectIds.length}`)
    lines.push("")
    lines.push("| Project | Status | Detail |")
    lines.push("| --- | --- | --- |")
    for (const item of result?.results || []) {
      const projectName =
        item.projectName ||
        selectedTeam?.projects.find((project) => project.id === item.projectId)?.name ||
        item.projectId
      const detail = item.ok
        ? result?.dryRun
          ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
          : `created=${item.createdCount}, skipped=${item.skippedCount}`
        : item.message
      lines.push(
        `| ${projectName.replace(/\|/g, "\\|")} | ${item.ok ? "OK" : "FAILED"} | ${detail.replace(/\|/g, "\\|")} |`
      )
    }
    return lines.join("\n")
  }

  const copyReport = async () => {
    if (!result || result.results.length === 0) return
    setCopying(true)
    setError(null)
    try {
      await navigator.clipboard.writeText(buildMarkdownReport())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy report")
    } finally {
      setCopying(false)
    }
  }

  const downloadReport = () => {
    if (!result || result.results.length === 0) return
    setDownloading(true)
    setError(null)
    try {
      const text = buildMarkdownReport()
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `team-starter-pack-quick-apply-${packId.toLowerCase()}-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const selectAllProjects = () => {
    if (!selectedTeam) return
    setSelectedProjectIds(selectedTeam.projects.map((project) => project.id))
  }

  const clearProjects = () => {
    setSelectedProjectIds([])
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={teams.length === 0}
        title={teams.length === 0 ? "No admin teams with editable projects available" : `Team quick apply ${packName}`}
        className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        Team Quick Apply
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Team Quick Apply {packName}</h3>
            <p className="mt-1 text-sm text-gray-600">
              Apply this starter pack to selected projects inside one team.
            </p>

            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {result && (
              <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                {result.dryRun
                  ? `Preview done: ${result.successCount}/${result.total} succeeded, ${result.failedCount} failed.`
                  : `Applied: ${result.successCount}/${result.total} succeeded, ${result.failedCount} failed.`}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Team</label>
                <select
                  value={selectedTeamId}
                  onChange={(event) => handleTeamChange(event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.projects.length} projects)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Projects</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllProjects}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearProjects}
                      className="text-xs text-gray-600 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto rounded border border-gray-300 p-2">
                  {(selectedTeam?.projects || []).map((project) => (
                    <label
                      key={project.id}
                      className="flex items-center gap-2 px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={(event) => toggleProject(project.id, event.target.checked)}
                      />
                      <span>{project.name}</span>
                    </label>
                  ))}
                  {(selectedTeam?.projects.length || 0) === 0 && (
                    <div className="px-1 py-2 text-xs text-gray-500">No projects in this team.</div>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Selected {selectedProjectIds.length} / {selectedTeam?.projects.length || 0}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                Dry run preview
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={copyReport}
                disabled={copying || !result || result.results.length === 0}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {copying ? "Copying..." : "Copy Report"}
              </button>
              <button
                type="button"
                onClick={downloadReport}
                disabled={downloading || !result || result.results.length === 0}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {downloading ? "Downloading..." : "Download .md"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setError(null)
                  setResult(null)
                }}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={run}
                disabled={loading || !selectedTeamId || selectedProjectIds.length === 0}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? "Running..." : dryRun ? "Preview" : "Apply"}
              </button>
              <button
                type="button"
                onClick={retryFailed}
                disabled={loading || failedProjectIds.length === 0}
                className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                Retry Failed ({failedProjectIds.length})
              </button>
            </div>

            {result && result.results.length > 0 && (
              <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">Result Details</div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {result.results.map((item) => {
                    const projectName =
                      item.projectName ||
                      selectedTeam?.projects.find((project) => project.id === item.projectId)?.name ||
                      item.projectId
                    const detail = result.dryRun
                      ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
                      : `created=${item.createdCount}, skipped=${item.skippedCount}`
                    return (
                      <div key={`${item.projectId}-${item.message}`} className="text-xs text-gray-700">
                        <span
                          className={`mr-1 rounded px-1 py-0.5 text-[10px] ${
                            item.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {item.ok ? "OK" : "FAILED"}
                        </span>
                        {projectName}: {item.message} ({detail})
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
