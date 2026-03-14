"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type DispatchPolicyResponse = {
  projectId: string
  onlineOnly: boolean
  updatedAt: string | null
  source: "project" | "default"
}

interface ProjectDispatchPolicyPanelProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
}

export function ProjectDispatchPolicyPanel({
  projectId,
  currentUserRole
}: ProjectDispatchPolicyPanelProps) {
  const [policy, setPolicy] = useState<DispatchPolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"

  const fetchPolicy = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/dispatch-policy`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to fetch dispatch policy"))
      }
      const data = (await response.json()) as DispatchPolicyResponse
      setPolicy(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch dispatch policy")
      setPolicy(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPolicy().catch(() => undefined)
  }, [projectId])

  const savePolicy = async (onlineOnly: boolean) => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/dispatch-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlineOnly })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to update dispatch policy"))
      }
      await fetchPolicy()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update dispatch policy")
    } finally {
      setSaving(false)
    }
  }

  const resetDefault = async () => {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/dispatch-policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to reset dispatch policy"))
      }
      await fetchPolicy()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset dispatch policy")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      id="agent-dispatch-policy"
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Agent Dispatch Policy</h2>
        {policy && (
          <span className="text-xs text-gray-500">
            Source: {policy.source}
            {policy.updatedAt ? ` · Updated ${new Date(policy.updatedAt).toLocaleString()}` : ""}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-gray-600">
        Control whether project dispatch should only use online agents.
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Loading dispatch policy...</div>
      ) : error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      ) : !policy ? (
        <div className="text-sm text-gray-500">Dispatch policy unavailable</div>
      ) : (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={policy.onlineOnly}
              disabled={!canEdit || saving}
              onChange={(e) => savePolicy(e.target.checked)}
            />
            Online agents only
          </label>
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
