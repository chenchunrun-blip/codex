"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type RecommendedTemplate = {
  id: string
  name: string
  category: string
  description: string | null
  isBuiltIn?: boolean
}

interface ProjectTemplateRecommendationsPanelProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
  onApplied?: () => void
}

export function ProjectTemplateRecommendationsPanel({
  projectId,
  currentUserRole,
  onApplied
}: ProjectTemplateRecommendationsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [runningTemplateId, setRunningTemplateId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [source, setSource] = useState<string>("builtin_fallback")
  const [templates, setTemplates] = useState<RecommendedTemplate[]>([])
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"

  const fetchRecommendations = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/template-recommendations`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch template recommendations"))
      }
      setSource(typeof payload?.recommendationSource === "string" ? payload.recommendationSource : "builtin_fallback")
      setTemplates(Array.isArray(payload?.templates) ? payload.templates : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch template recommendations")
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecommendations().catch(() => undefined)
  }, [projectId])

  const rolloutTemplate = async (templateId: string, dryRun: boolean) => {
    if (!canEdit) return
    setRunningTemplateId(templateId)
    setError(null)
    setInfo(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          skipExistingByTemplateType: true,
          dryRun
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to roll out template"))
      }
      const name =
        templates.find((item) => item.id === templateId)?.name || payload?.templateName || "Template"
      if (dryRun) {
        setInfo(`Preview ${name}: wouldCreate ${payload.wouldCreateCount || 0}, skipped ${payload.skippedCount || 0}.`)
      } else {
        setInfo(`Applied ${name}: created ${payload.createdCount || 0}, skipped ${payload.skippedCount || 0}.`)
        onApplied?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to roll out template")
    } finally {
      setRunningTemplateId(null)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Recommended Templates</h2>
        <button
          type="button"
          onClick={() => fetchRecommendations().catch(() => undefined)}
          disabled={loading}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <p className="mb-3 text-sm text-gray-600">
        Recommendation source: {source === "project_usage" ? "project usage" : "built-in fallback"}
      </p>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {info && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{info}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading recommendations...</div>
      ) : templates.length === 0 ? (
        <div className="text-sm text-gray-500">No template recommendations yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <div key={template.id} className="rounded border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{template.name}</div>
                {template.isBuiltIn && (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    Built-in
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-blue-700">{template.category}</div>
              {template.description && (
                <div className="mt-2 text-xs text-gray-600 line-clamp-2">{template.description}</div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => rolloutTemplate(template.id, true)}
                  disabled={!canEdit || runningTemplateId === template.id}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {runningTemplateId === template.id ? "Running..." : "Preview"}
                </button>
                <button
                  type="button"
                  onClick={() => rolloutTemplate(template.id, false)}
                  disabled={!canEdit || runningTemplateId === template.id}
                  className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {runningTemplateId === template.id ? "Applying..." : "Apply"}
                </button>
                <a
                  href={`/templates?category=${template.category}`}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
