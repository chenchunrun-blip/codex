"use client"

import { useEffect, useState } from "react"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"

interface ProjectItem {
  id: string
  name: string
}

interface ExportTasksReportButtonProps {
  endpoint?: string
  defaultSourceProjectId?: string
  defaultStatus?: string
}

export function ExportTasksReportButton({
  endpoint = "/api/tasks/report",
  defaultSourceProjectId,
  defaultStatus
}: ExportTasksReportButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [sourceProjectId, setSourceProjectId] = useState(defaultSourceProjectId || "")
  const [status, setStatus] = useState(defaultStatus || "")

  const fetchProjects = async () => {
    setLoadingProjects(true)
    setError(null)
    try {
      const items = await fetchProjectOptionsCached()
      setProjects(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
      setProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }

  useEffect(() => {
    if (!showDialog) return
    setSourceProjectId(defaultSourceProjectId || "")
    setStatus(defaultStatus || "")
    fetchProjects().catch(() => undefined)
  }, [showDialog, defaultSourceProjectId, defaultStatus])

  const runExport = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (sourceProjectId) params.set("sourceProjectId", sourceProjectId)
      if (status) params.set("status", status)
      params.set("format", "markdown")

      const response = await fetch(`${endpoint}?${params.toString()}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(payload, "Failed to export tasks report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const sourceScope = sourceProjectId ? "scoped" : "all"
      anchor.href = url
      anchor.download = `tasks-report-${sourceScope}-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export tasks report")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Export Tasks
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Export Tasks Report</h3>
            <p className="mt-1 text-sm text-gray-600">
              Configure report scope and download markdown.
            </p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Source Project (optional)</label>
                <select
                  value={sourceProjectId}
                  onChange={(e) => setSourceProjectId(e.target.value)}
                  disabled={loadingProjects || loading}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Accessible Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Status Filter (optional)</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  <option value="PENDING">PENDING</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="REVIEW">REVIEW</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runExport}
                disabled={loading || loadingProjects}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Exporting..." : "Export Markdown"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
