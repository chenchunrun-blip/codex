"use client"

import { useEffect, useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchTeamOptionsCached } from "@/lib/reports/team-options-cache"
interface TeamItem {
  id: string
  name: string
}

interface ExportTeamWorkspaceReportHubButtonProps {
  defaultTeamId?: string
}

export function ExportTeamWorkspaceReportHubButton({
  defaultTeamId
}: ExportTeamWorkspaceReportHubButtonProps = {}) {
  const [showDialog, setShowDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [teamId, setTeamId] = useState("")

  const fetchTeams = async () => {
    setLoadingTeams(true)
    setError(null)
    try {
      const items = await fetchTeamOptionsCached()
      setTeams(items)
      const preferredTeamId =
        defaultTeamId && items.some((item) => item.id === defaultTeamId) ? defaultTeamId : items[0]?.id || ""
      setTeamId(preferredTeamId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams")
      setTeams([])
      setTeamId("")
    } finally {
      setLoadingTeams(false)
    }
  }

  useEffect(() => {
    if (!showDialog) return
    fetchTeams().catch(() => undefined)
  }, [showDialog, defaultTeamId])

  const runExport = async () => {
    if (!teamId) return
    setExporting(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/workspace-report?format=markdown`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to export team workspace report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `team-workspace-report-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export team workspace report")
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Export Team Workspace
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Export Team Workspace Report</h3>
            <p className="mt-1 text-sm text-gray-600">Choose a team and download markdown report.</p>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Team</label>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  disabled={loadingTeams || exporting || teams.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
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
                disabled={exporting || loadingTeams || !teamId}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {exporting ? "Exporting..." : "Export Markdown"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
