"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface ProjectOption {
  id: string
  name: string
}

interface TeamTemplateQuickUseProps {
  templateId: string
  templateName: string
  projects: ProjectOption[]
}

export function TeamTemplateQuickUse({
  templateId,
  templateName,
  projects
}: TeamTemplateQuickUseProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || "")

  const handleCreate = async () => {
    if (!selectedProjectId) {
      setError("Please select a project.")
      return
    }
      setLoading(true)
      setError("")
      try {
      const response = await fetchWithTimeoutRetry(
        "/api/files",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProjectId,
            templateId
          })
        },
        {
          timeoutMs: 8000,
          maxRetries: 2,
          retryDelayMs: 300
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to create file from template"))
      }
      setOpen(false)
      router.push(`/editor/${payload.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file from template")
    } finally {
      setLoading(false)
    }
  }

  if (projects.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-400"
      >
        No project available
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Use ${templateName} in a project`}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        Use in Project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 p-4">
              <h3 className="text-lg font-semibold text-gray-900">Use Template in Project</h3>
              <p className="mt-1 text-sm text-gray-500">{templateName}</p>
            </div>
            <div className="space-y-3 p-4">
              {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                disabled={loading}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setError("")
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create File"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
