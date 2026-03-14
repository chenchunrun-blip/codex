"use client"

import { useEffect, useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"
interface ProjectItem {
  id: string
  name: string
}

interface SaveTemplatesCatalogButtonProps {
  endpoint?: string
}

export function SaveTemplatesCatalogButton({
  endpoint = "/api/templates/catalog/save"
}: SaveTemplatesCatalogButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [fileName, setFileName] = useState("")

  const fetchProjects = async () => {
    setLoadingProjects(true)
    setError(null)
    try {
      const items = await fetchProjectOptionsCached()
      setProjects(items)
      if (items.length > 0) setSelectedProjectId(items[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
      setProjects([])
      setSelectedProjectId("")
    } finally {
      setLoadingProjects(false)
    }
  }

  useEffect(() => {
    if (!showDialog) return
    fetchProjects().catch(() => undefined)
  }, [showDialog])

  const save = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId || undefined,
          fileName: fileName.trim() || undefined
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save templates catalog"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save templates catalog")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
      >
        Save Templates
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Save Templates Catalog</h3>
            <p className="mt-1 text-sm text-gray-600">
              Choose target project and optional filename.
            </p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Project</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={loadingProjects || loading || projects.length === 0}
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
                <label className="mb-1 block text-sm font-medium text-gray-700">File Name (optional)</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="templates-catalog-custom.md"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
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
                onClick={save}
                disabled={loading || loadingProjects || projects.length === 0}
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
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
