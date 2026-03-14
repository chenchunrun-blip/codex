"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface ProjectItem {
  id: string
  name: string
}

interface SaveTeamRolloutHistoryButtonProps {
  teamId: string
  projects: ProjectItem[]
}

export function SaveTeamRolloutHistoryButton({
  teamId,
  projects
}: SaveTeamRolloutHistoryButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id || "")
  const [limit, setLimit] = useState("50")
  const [fileName, setFileName] = useState("")

  const save = async () => {
    if (!targetProjectId) {
      setError("Please select a target project.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const parsedLimit = Number(limit)
      const response = await fetch("/api/teams/starter-files/history/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          targetProjectId,
          limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
          fileName: fileName.trim() || undefined
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save team rollout history"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save team rollout history")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
      >
        Save Rollout History
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Save Team Rollout History</h3>
            <p className="mt-1 text-sm text-gray-600">Save a markdown history report into a project file.</p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Target Project</label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                  disabled={loading || projects.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Limit</label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">File Name (optional)</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="team-rollout-history-custom.md"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={loading || projects.length === 0 || !targetProjectId}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
