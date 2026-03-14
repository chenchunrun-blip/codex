"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type SchedulerConfigResponse = {
  projectId: string
  enabled: boolean
  defaultLimit: number
  defaultAutoSubmit: boolean
  updatedAt: string | null
  source: "project" | "default"
}

interface ProjectSchedulerConfigPanelProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
}

export function ProjectSchedulerConfigPanel({
  projectId,
  currentUserRole
}: ProjectSchedulerConfigPanelProps) {
  const [config, setConfig] = useState<SchedulerConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"

  const fetchConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/scheduler-config`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to fetch scheduler config"))
      }
      const data = (await response.json()) as SchedulerConfigResponse
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch scheduler config")
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig().catch(() => undefined)
  }, [projectId])

  const updateConfig = async (next: Partial<SchedulerConfigResponse>) => {
    if (!canEdit || !config) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/scheduler-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled ?? config.enabled,
          defaultLimit: next.defaultLimit ?? config.defaultLimit,
          defaultAutoSubmit: next.defaultAutoSubmit ?? config.defaultAutoSubmit
        })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to update scheduler config"))
      }
      await fetchConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update scheduler config")
    } finally {
      setSaving(false)
    }
  }

  const resetDefault = async () => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/scheduler-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to reset scheduler config"))
      }
      await fetchConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset scheduler config")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Scheduler Defaults</h2>
        {config && (
          <span className="text-xs text-gray-500">
            Source: {config.source}
            {config.updatedAt ? ` · Updated ${new Date(config.updatedAt).toLocaleString()}` : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading scheduler config...</div>
      ) : error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : !config ? (
        <div className="text-sm text-gray-500">Scheduler config unavailable</div>
      ) : (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!canEdit || saving}
              onChange={(e) => updateConfig({ enabled: e.target.checked })}
            />
            Enable scheduler for this project
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-700">
              Default task limit
              <input
                type="number"
                min={1}
                max={20}
                value={config.defaultLimit}
                disabled={!canEdit || saving}
                onChange={(e) => updateConfig({ defaultLimit: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })}
                className="ml-2 w-20 rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={config.defaultAutoSubmit}
                disabled={!canEdit || saving}
                onChange={(e) => updateConfig({ defaultAutoSubmit: e.target.checked })}
              />
              Default auto-submit deliverables
            </label>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button
                onClick={resetDefault}
                disabled={saving}
                className="rounded bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Reset to Default"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
