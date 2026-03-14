"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { REPORT_METADATA_TYPES, reportMetadataTypeLabel } from "@/lib/reports/metadata"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"

interface ProjectItem {
  id: string
  name: string
}

interface SaveReportsHistoryButtonProps {
  endpoint?: string
  defaultType?: string
  defaultProjectId?: string
  defaultQuery?: string
  defaultPage?: number
  defaultLimit?: number
}

export function SaveReportsHistoryButton({
  endpoint = "/api/reports/history/save",
  defaultType = "",
  defaultProjectId = "",
  defaultQuery = "",
  defaultPage = 1,
  defaultLimit = 50
}: SaveReportsHistoryButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [type, setType] = useState(defaultType)
  const [sourceProjectId, setSourceProjectId] = useState(defaultProjectId)
  const [query, setQuery] = useState(defaultQuery)
  const [page, setPage] = useState(String(defaultPage > 0 ? defaultPage : 1))
  const [limit, setLimit] = useState(String(defaultLimit > 0 ? defaultLimit : 50))
  const [fileName, setFileName] = useState("")

  useEffect(() => {
    if (!showDialog) return
    setType(defaultType)
    setSourceProjectId(defaultProjectId)
    setQuery(defaultQuery)
    setPage(String(defaultPage > 0 ? defaultPage : 1))
    setLimit(String(defaultLimit > 0 ? defaultLimit : 50))
  }, [showDialog, defaultType, defaultProjectId, defaultQuery, defaultPage, defaultLimit])

  const fetchProjects = async () => {
    if (projects.length > 0) {
      if (!selectedProjectId) {
        const preferredProjectId =
          defaultProjectId && projects.some((project) => project.id === defaultProjectId)
            ? defaultProjectId
            : projects[0]?.id || ""
        setSelectedProjectId(preferredProjectId)
      }
      return
    }

    setLoadingProjects(true)
    setError(null)
    try {
      const items = await fetchProjectOptionsCached()
      setProjects(items)
      if (items.length > 0) {
        const preferredProjectId =
          defaultProjectId && items.some((project) => project.id === defaultProjectId)
            ? defaultProjectId
            : items[0].id
        setSelectedProjectId(preferredProjectId)
      }
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
  }, [showDialog, defaultProjectId, projects, selectedProjectId])

  const save = async () => {
    setLoading(true)
    setError(null)
    try {
      const parsedLimit = Number(limit)
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProjectId: selectedProjectId || undefined,
          type: type || undefined,
          projectId: sourceProjectId || undefined,
          q: query.trim() || undefined,
          page: Number(page) > 1 ? Number(page) : undefined,
          limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
          fileName: fileName.trim() || undefined
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save reports history"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save reports history")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
      >
        Save History
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Save Reports History</h3>
            <p className="mt-1 text-sm text-gray-600">Save current history scope into a markdown file.</p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Target Project</label>
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Type Filter (optional)</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Report Types</option>
                  {REPORT_METADATA_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {reportMetadataTypeLabel(item)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Source Project (optional)</label>
                <select
                  value={sourceProjectId}
                  onChange={(e) => setSourceProjectId(e.target.value)}
                  disabled={loadingProjects || loading || projects.length === 0}
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Search (optional)</label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="owner alpha"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Page</label>
                <input
                  type="number"
                  min={1}
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">File Name (optional)</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="reports-history-custom.md"
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
