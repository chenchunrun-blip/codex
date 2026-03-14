"use client"

import { useEffect, useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"
interface ProjectItem {
  id: string
  name: string
}

export function ExportProjectWorkspaceReportButton() {
  const [showDialog, setShowDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectId, setProjectId] = useState("")

  const fetchProjects = async () => {
    setLoadingProjects(true)
    setError(null)
    try {
      const items = await fetchProjectOptionsCached()
      setProjects(items)
      if (items.length > 0) {
        setProjectId(items[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
      setProjects([])
      setProjectId("")
    } finally {
      setLoadingProjects(false)
    }
  }

  useEffect(() => {
    if (!showDialog) return
    fetchProjects().catch(() => undefined)
  }, [showDialog])

  const runExport = async () => {
    if (!projectId) return
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/workspace-report?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export project workspace report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `project-workspace-report-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export project workspace report")
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Export Project Workspace
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Export Project Workspace Report</h3>
            <p className="mt-1 text-sm text-gray-600">Choose a project and download markdown report.</p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Project</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={loadingProjects || exporting || projects.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
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
                disabled={exporting || loadingProjects || !projectId}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {exporting ? "Exporting..." : "Export Markdown"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
