"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type RetryConfigResponse = {
  projectId: string
  retryableErrorCodes: string[]
  availableRetryableErrorCodes: string[]
  updatedAt: string | null
  source: "project" | "default"
}

interface ProjectRetryConfigPanelProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
}

export function ProjectRetryConfigPanel({ projectId, currentUserRole }: ProjectRetryConfigPanelProps) {
  const [config, setConfig] = useState<RetryConfigResponse | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"

  const fetchConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/retry-config`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to fetch retry config"))
      }
      const data = (await response.json()) as RetryConfigResponse
      setConfig(data)
      setDraft(data.retryableErrorCodes || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch retry config")
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig().catch(() => undefined)
  }, [projectId])

  const saveConfig = async () => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/retry-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryableErrorCodes: draft })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to save retry config"))
      }
      await fetchConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save retry config")
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = async () => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/retry-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to reset retry config"))
      }
      await fetchConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset retry config")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      id="agent-retry-policy"
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Agent Retry Policy</h2>
        {config && (
          <span className="text-xs text-gray-500">
            Source: {config.source}
            {config.updatedAt ? ` · Updated ${new Date(config.updatedAt).toLocaleString()}` : ""}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-gray-600">
        Configure which agent execution errors are retryable for this project.
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Loading retry config...</div>
      ) : error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : !config ? (
        <div className="text-sm text-gray-500">Retry config unavailable</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {config.availableRetryableErrorCodes.map((code) => (
              <label
                key={code}
                className="inline-flex items-center gap-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(code)}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setDraft((prev) =>
                      e.target.checked
                        ? Array.from(new Set([...prev, code]))
                        : prev.filter((item) => item !== code)
                    )
                  }}
                />
                {code}
              </label>
            ))}
          </div>
          {canEdit && (
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={resetToDefault}
                disabled={saving}
                className="rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
              >
                Reset to Default
              </button>
              <button
                onClick={saveConfig}
                disabled={saving || draft.length === 0}
                className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
