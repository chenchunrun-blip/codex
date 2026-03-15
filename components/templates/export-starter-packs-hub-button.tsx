"use client"

import { useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
interface ExportStarterPacksHubButtonProps {
  endpoint?: string
}

export function ExportStarterPacksHubButton({
  endpoint = "/api/templates/starter-packs"
}: ExportStarterPacksHubButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`${endpoint}?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export starter packs"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `template-starter-packs-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export starter packs error:", error)
      setError(error instanceof Error ? error.message : "Failed to export starter packs")
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
        {exporting ? "Exporting..." : "Export Starter Packs"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
