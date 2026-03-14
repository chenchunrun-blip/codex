"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface SaveFileTasksReportButtonProps {
  fileId: string
}

export function SaveFileTasksReportButton({ fileId }: SaveFileTasksReportButtonProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/files/${fileId}/tasks-report/save`, {
        method: "POST"
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to save tasks report file"))
      }
      if (data?.file?.id) {
        window.location.href = `/editor/${data.file.id}`
      } else {
        window.location.reload()
      }
    } catch (error) {
      console.error("Save file tasks report error:", error)
      setError(error instanceof Error ? error.message : "Failed to save tasks report file")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="text-emerald-600 hover:text-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Save linked tasks report as project markdown file"
      >
        {saving ? "Saving..." : "Save Tasks Report"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
