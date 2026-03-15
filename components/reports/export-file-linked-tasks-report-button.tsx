"use client"

import { useEffect, useMemo, useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
interface FileItem {
  id: string
  name: string
  project?: {
    id: string
    name: string
  } | null
}

export function ExportFileLinkedTasksReportButton() {
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [selectedFileId, setSelectedFileId] = useState("")

  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const file of files) {
      if (!file.project?.id || !file.project?.name) continue
      if (!seen.has(file.project.id)) {
        seen.set(file.project.id, file.project.name)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [files])

  const filteredFiles = useMemo(() => {
    if (!selectedProjectId) return files
    return files.filter((file) => file.project?.id === selectedProjectId)
  }, [files, selectedProjectId])

  const fetchFiles = async () => {
    setLoadingFiles(true)
    setError(null)
    try {
      const response = await fetch("/api/files")
      const payload = await response.json().catch(() => [])
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load files"))
      }
      const items = Array.isArray(payload) ? (payload as FileItem[]) : []
      setFiles(items)
      if (items.length > 0) {
        setSelectedFileId(items[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setFiles([])
      setSelectedFileId("")
    } finally {
      setLoadingFiles(false)
    }
  }

  useEffect(() => {
    if (!showDialog) return
    fetchFiles().catch(() => undefined)
  }, [showDialog])

  useEffect(() => {
    if (!showDialog) return
    if (filteredFiles.length === 0) {
      setSelectedFileId("")
      return
    }
    if (!filteredFiles.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(filteredFiles[0].id)
    }
  }, [filteredFiles, selectedFileId, showDialog])

  const runExport = async () => {
    if (!selectedFileId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/files/${selectedFileId}/tasks-report?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export file linked tasks report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `file-linked-tasks-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export file linked tasks report")
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
        Export File Tasks
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Export File Linked Tasks Report</h3>
            <p className="mt-1 text-sm text-gray-600">Choose source file and export markdown report.</p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Project Filter</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={loadingFiles || loading}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Source File</label>
                <select
                  value={selectedFileId}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  disabled={loadingFiles || loading || filteredFiles.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {filteredFiles.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name} {file.project?.name ? `(${file.project.name})` : ""}
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
                disabled={loading || loadingFiles || !selectedFileId}
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
