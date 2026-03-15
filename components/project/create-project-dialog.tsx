"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { clearProjectOptionsCache } from "@/lib/reports/project-options-cache"
import { fetchTeamOptionsCached } from "@/lib/reports/team-options-cache"
import { fetchTemplateOptionsCached } from "@/lib/reports/template-options-cache"

export function CreateProjectDialog() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [starterTemplates, setStarterTemplates] = useState<Array<{
    id: string
    name: string
    category: string
    description?: string | null
  }>>([])
  const [selectedStarterTemplateIds, setSelectedStarterTemplateIds] = useState<string[]>([])
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    teamId: ""
  })

  useEffect(() => {
    if (isOpen) {
      Promise.all([
        fetchTeamOptionsCached(),
        fetchTemplateOptionsCached({ visibility: "BUILT_IN" })
      ])
        .then(([teamData, templateData]) => {
          setTeams(Array.isArray(teamData) ? teamData : [])
          setStarterTemplates(Array.isArray(templateData) ? templateData : [])
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams"))
    }
  }, [isOpen])

  const starterPacks = deriveStarterTemplatePacks(starterTemplates)

  const toggleStarterTemplate = (templateId: string, checked: boolean) => {
    setSelectedStarterTemplateIds((prev) => {
      if (checked) {
        return prev.includes(templateId) ? prev : [...prev, templateId]
      }
      return prev.filter((id) => id !== templateId)
    })
  }

  const applyStarterPack = (templateIds: string[]) => {
    setSelectedStarterTemplateIds(Array.from(new Set(templateIds)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          starterTemplateIds: selectedStarterTemplateIds
        })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(mapReportApiErrorFromPayload(data, "Failed to create project"))
      } else {
        clearProjectOptionsCache()
        setIsOpen(false)
        router.push(`/projects/${data.id}`)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project")
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Create Project
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create New Project</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="teamId" className="block text-sm font-medium text-gray-700 mb-2">
              Team
            </label>
            <select
              id="teamId"
              value={formData.teamId}
              onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Project Name
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My Project"
              required
              minLength={2}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description (optional)
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What is this project for?"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Starter Files (optional)
            </label>
            <p className="mb-2 text-xs text-gray-500">
              Create initial files from built-in templates right after project creation.
            </p>
            {starterPacks.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {starterPacks.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => applyStarterPack(pack.templateIds)}
                    className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                    title={pack.description}
                  >
                    {pack.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedStarterTemplateIds([])}
                  className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto rounded border border-gray-200 p-2 space-y-2">
              {starterTemplates.length === 0 ? (
                <div className="text-xs text-gray-500">No built-in templates found.</div>
              ) : (
                starterTemplates.map((template) => (
                  <label key={template.id} className="flex items-start gap-2 rounded px-2 py-1 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedStarterTemplateIds.includes(template.id)}
                      onChange={(e) => toggleStarterTemplate(template.id, e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm text-gray-900">{template.name}</span>
                      <span className="block text-xs text-gray-500">{template.category}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
