"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchTemplateOptionsCached } from "@/lib/reports/template-options-cache"

interface CreateFileDialogProps {
  projectId: string
  projectName?: string
}

export function CreateFileDialog({ projectId, projectName }: CreateFileDialogProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; category: string }>>([])
  const [recommendedTemplates, setRecommendedTemplates] = useState<Array<{ id: string; name: string; category: string }>>([])
  const [showAllTemplates, setShowAllTemplates] = useState(false)
  const [recommendationSource, setRecommendationSource] = useState<"project_usage" | "builtin_fallback" | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [fileName, setFileName] = useState("")

  useEffect(() => {
    if (isOpen) {
      setError("")
      Promise.all([
        fetchTemplateOptionsCached(),
        fetch(`/api/projects/${projectId}/template-recommendations`)
      ])
        .then(async ([allTemplates, recommendationRes]) => {
          const recommendationData = recommendationRes.ok
            ? await recommendationRes.json().catch(() => ({ templates: [], recommendationSource: null }))
            : { templates: [], recommendationSource: null }

          setTemplates(Array.isArray(allTemplates) ? allTemplates : [])
          setRecommendedTemplates(
            Array.isArray(recommendationData?.templates) ? recommendationData.templates : []
          )
          setRecommendationSource(
            recommendationData?.recommendationSource === "project_usage"
              ? "project_usage"
              : recommendationData?.recommendationSource === "builtin_fallback"
                ? "builtin_fallback"
                : null
          )
        })
        .catch((err) => {
          setTemplates([])
          setRecommendedTemplates([])
          setRecommendationSource(null)
          setError(err instanceof Error ? err.message : "Failed to load templates")
        })
    }
  }, [isOpen, projectId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          templateId: selectedTemplate || undefined,
          name: fileName || undefined,
          content: "" // Will be filled from template if selected
        })
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(mapReportApiErrorFromPayload(data, "Failed to create file"))
      } else {
        setIsOpen(false)
        router.push(`/editor/${data.id}`)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file")
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
        New File
      </button>
    )
  }

  const categoryIcons: Record<string, string> = {
    PROBLEM_DEFINITION: "🎯",
    SOLUTION_DESIGN: "💡",
    EXECUTION_TRACKING: "📊",
    RETROSPECTIVE_SUMMARY: "📝",
    CUSTOM: "📄"
  }
  const visibleTemplates = showAllTemplates || recommendedTemplates.length === 0 ? templates : recommendedTemplates

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 break-words">Create New File</h2>
          <p className="text-sm text-gray-500 mt-1 break-words">
            {projectName && `Project: ${projectName}`}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          {/* Template Selection */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Choose Template (optional)
              </label>
              <button
                type="button"
                onClick={() => setShowAllTemplates((prev) => !prev)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                {showAllTemplates || recommendedTemplates.length === 0 ? "Show Recommended" : "Show All"}
              </button>
            </div>
            {recommendedTemplates.length > 0 && !showAllTemplates && (
              <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                {recommendationSource === "project_usage"
                  ? "Recommended from this project's historical template usage."
                  : "Recommended built-in templates."}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button
                type="button"
                onClick={() => setSelectedTemplate("")}
                className={`p-4 border-2 rounded-lg text-left transition-colors ${
                  selectedTemplate === ""
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="text-2xl mb-2">📄</div>
                <div className="font-medium text-gray-900">Blank File</div>
                <div className="text-xs text-gray-500">Start from scratch</div>
              </button>

              {visibleTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template.id)}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    selectedTemplate === template.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-2xl mb-2">{categoryIcons[template.category] || "📄"}</div>
                  <div className="font-medium text-gray-900 break-words">{template.name}</div>
                  <div className="text-xs text-gray-500">{template.category.replace(/_/g, ' ')}</div>
                </button>
              ))}
            </div>
          </div>

          {/* File Name */}
          <div>
            <label htmlFor="fileName" className="block text-sm font-medium text-gray-700 mb-2">
              File Name (optional)
            </label>
            <input
              id="fileName"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Auto-generated if left blank"
            />
            <p className="mt-1 text-xs text-gray-500">
              Format: {projectName || "ProjectName"}-TemplateName-YYYYMMDD
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
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
              {isLoading ? "Creating..." : "Create File"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
