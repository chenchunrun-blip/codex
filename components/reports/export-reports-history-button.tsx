"use client"

import { useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
interface ExportReportsHistoryButtonProps {
  defaultType?: string
  defaultProjectId?: string
  defaultQuery?: string
  defaultPage?: number
  defaultLimit?: number
}

export function ExportReportsHistoryButton({
  defaultType,
  defaultProjectId,
  defaultQuery,
  defaultPage = 1,
  defaultLimit = 50
}: ExportReportsHistoryButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (defaultType) params.set("type", defaultType)
      if (defaultProjectId) params.set("projectId", defaultProjectId)
      if (defaultQuery) params.set("q", defaultQuery)
      if (defaultPage > 1) params.set("page", String(defaultPage))
      if (defaultLimit > 0) params.set("limit", String(defaultLimit))
      params.set("format", "markdown")
      const response = await fetch(`/api/reports/history?${params.toString()}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export reports history"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `reports-history-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to export reports history")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={runExport}
        disabled={exporting}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {exporting ? "Exporting..." : "Export History"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
