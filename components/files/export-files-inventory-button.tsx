"use client"

import { useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
interface ExportFilesInventoryButtonProps {
  sourceProjectId?: string
  endpoint?: string
}

export function ExportFilesInventoryButton({
  sourceProjectId,
  endpoint = "/api/files/inventory"
}: ExportFilesInventoryButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportMarkdown = async () => {
    setExporting(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (sourceProjectId) {
        params.set("sourceProjectId", sourceProjectId)
      }
      params.set("format", "markdown")
      const response = await fetch(`${endpoint}?${params.toString()}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export files inventory"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const scope = sourceProjectId ? "scoped" : "all"
      anchor.href = url
      anchor.download = `file-inventory-${scope}-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to export files inventory")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={exportMarkdown}
        disabled={exporting}
        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
      >
        {exporting ? "Exporting..." : "Export Inventory"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
