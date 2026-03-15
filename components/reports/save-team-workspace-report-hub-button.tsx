"use client"

import { useEffect, useState } from "react"

import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchTeamOptionsCached } from "@/lib/reports/team-options-cache"
interface TeamItem {
  id: string
  name: string
}

interface ProjectItem {
  id: string
  name: string
}

interface SaveTeamWorkspaceReportHubButtonProps {
  defaultTeamId?: string
  defaultTargetProjectId?: string
}

export function SaveTeamWorkspaceReportHubButton({
  defaultTeamId,
  defaultTargetProjectId
}: SaveTeamWorkspaceReportHubButtonProps = {}) {
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamItem[]>([])
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [teamId, setTeamId] = useState("")
  const [targetProjectId, setTargetProjectId] = useState("")
  const [fileName, setFileName] = useState("")

  const fetchTeams = async () => {
    const items = await fetchTeamOptionsCached()
    setTeams(items)
    return defaultTeamId && items.some((item) => item.id === defaultTeamId) ? defaultTeamId : items[0]?.id || ""
  }

  const fetchProjectsByTeam = async (selectedTeamId: string) => {
    if (!selectedTeamId) {
      setProjects([])
      setTargetProjectId("")
      return
    }
    const response = await fetch(`/api/projects?teamId=${selectedTeamId}`)
    const payload = await response.json().catch(() => [])
    if (!response.ok) throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load projects"))
    const items = Array.isArray(payload)
      ? payload.map((item: any) => ({ id: item.id, name: item.name }))
      : []
    setProjects(items)
    const preferredProjectId =
      defaultTargetProjectId && items.some((item) => item.id === defaultTargetProjectId)
        ? defaultTargetProjectId
        : items[0]?.id || ""
    setTargetProjectId(preferredProjectId)
  }

  useEffect(() => {
    if (!showDialog) return
    const run = async () => {
      setLoadingOptions(true)
      setError(null)
      try {
        const defaultTeamId = await fetchTeams()
        setTeamId(defaultTeamId)
        await fetchProjectsByTeam(defaultTeamId)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load options")
        setTeams([])
        setProjects([])
        setTeamId("")
        setTargetProjectId("")
      } finally {
        setLoadingOptions(false)
      }
    }
    run().catch(() => undefined)
  }, [showDialog, defaultTeamId, defaultTargetProjectId])

  const onTeamChange = async (nextTeamId: string) => {
    setTeamId(nextTeamId)
    setLoadingOptions(true)
    setError(null)
    try {
      await fetchProjectsByTeam(nextTeamId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
      setProjects([])
      setTargetProjectId("")
    } finally {
      setLoadingOptions(false)
    }
  }

  const save = async () => {
    if (!teamId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/workspace-report/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProjectId: targetProjectId || undefined,
          fileName: fileName.trim() || undefined
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to save team workspace report"))
      }
      if (payload?.file?.id) {
        window.location.href = `/editor/${payload.file.id}`
        return
      }
      setShowDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save team workspace report")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
      >
        Save Team Workspace
      </button>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Save Team Workspace Report</h3>
            <p className="mt-1 text-sm text-gray-600">Choose team and target project.</p>
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
                  onChange={(e) => onTeamChange(e.target.value).catch(() => undefined)}
                  disabled={loadingOptions || loading || teams.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Target Project</label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                  disabled={loadingOptions || loading || projects.length === 0}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">File Name (optional)</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="team-workspace-custom.md"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
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
                onClick={save}
                disabled={loading || loadingOptions || !teamId || !targetProjectId}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
