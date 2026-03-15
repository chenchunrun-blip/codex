"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface ExportFileTasksReportButtonProps {
  fileId: string
  fileName: string
}

export function ExportFileTasksReportButton({
  fileId,
  fileName
}: ExportFileTasksReportButtonProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onExport = async () => {
    setIsExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/files/${fileId}/tasks-report?format=markdown`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to export tasks report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const safeName = fileName.replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase()
      a.href = url
      a.download = `${safeName}-linked-tasks-report.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export file tasks report error:", error)
      setError(error instanceof Error ? error.message : "Failed to export tasks report")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onExport}
        disabled={isExporting}
        className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Export linked tasks report as markdown"
      >
        {isExporting ? "Exporting..." : "Export Tasks Report"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
