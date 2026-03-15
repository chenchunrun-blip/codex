"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface ProjectItem {
  id: string
  name: string
}

interface StarterPackQuickApplyButtonProps {
  packId: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
  packName: string
  projects: ProjectItem[]
}

export function StarterPackQuickApplyButton({
  packId,
  packName,
  projects
}: StarterPackQuickApplyButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    projects.length > 0 ? [projects[0].id] : []
  )
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

  const run = async () => {
    if (selectedProjectIds.length === 0) {
      setError("Please select at least one project.")
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch("/api/projects/starter-files/bulk-apply-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          projectIds: selectedProjectIds,
          dryRun,
          skipExistingByTemplateType: true
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to apply starter pack"))
      }
      setResult({
        total: payload?.total || 0,
        successCount: payload?.successCount || 0,
        failedCount: payload?.failedCount || 0,
        dryRun: payload?.dryRun === true,
        results: Array.isArray(payload?.results) ? payload.results : []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply starter pack")
    } finally {
      setLoading(false)
    }
  }

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const selectAllProjects = () => {
    setSelectedProjectIds(projects.map((project) => project.id))
  }

  const clearProjects = () => {
    setSelectedProjectIds([])
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={projects.length === 0}
        title={projects.length === 0 ? "No editable projects available" : `Quick apply ${packName}`}
        className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
      >
        Quick Apply
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Quick Apply {packName}</h3>
            <p className="mt-1 text-sm text-gray-600">Apply this starter pack directly to selected projects.</p>

            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {result && (
              <div className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                {result.dryRun
                  ? `Preview done: ${result.successCount}/${result.total} succeeded, ${result.failedCount} failed.`
                  : `Applied: ${result.successCount}/${result.total} succeeded, ${result.failedCount} failed.`}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Projects</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllProjects}
                      className="text-xs text-blue-600 hover:text-blue-700"
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
                  {projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 px-1 py-1 text-sm text-gray-700 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={(e) => toggleProject(project.id, e.target.checked)}
                      />
                      <span>{project.name}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Selected {selectedProjectIds.length} / {projects.length}
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                Dry run preview
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
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
                disabled={loading || selectedProjectIds.length === 0}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Running..." : dryRun ? "Preview" : "Apply"}
              </button>
            </div>
            {result && result.results.length > 0 && (
              <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">Result Details</div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {result.results.map((item) => {
                    const projectName =
                      item.projectName || projects.find((p) => p.id === item.projectId)?.name || item.projectId
                    const detail = result.dryRun
                      ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
                      : `created=${item.createdCount}, skipped=${item.skippedCount}`
                    return (
                      <div key={`${item.projectId}-${item.message}`} className="text-xs text-gray-700">
                        <span className={`mr-1 rounded px-1 py-0.5 text-[10px] ${
                          item.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
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
