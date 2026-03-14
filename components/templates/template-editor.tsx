"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { clearStarterPackOptionsCache } from "@/lib/reports/starter-pack-options-cache"
import { clearTemplateOptionsCache } from "@/lib/reports/template-options-cache"

interface TemplateEditorProps {
  mode?: "create" | "edit"
  templateId?: string
  initialData?: {
    name: string
    description: string
    category: string
    content: string
    isPublic: boolean
  }
}

export function TemplateEditor({ mode = "create", templateId, initialData }: TemplateEditorProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    description: initialData?.description || "",
    category: initialData?.category || "CUSTOM",
    content: initialData?.content || "",
    isPublic: initialData?.isPublic || false
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const endpoint = mode === "edit" && templateId ? `/api/templates/${templateId}` : "/api/templates"
      const method = mode === "edit" ? "PATCH" : "POST"
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, mode === "edit" ? "Failed to update template" : "Failed to create template"))
        return
      }

      clearTemplateOptionsCache()
      clearStarterPackOptionsCache()
      router.push("/templates")
    } catch (error) {
      console.error("Template save error:", error)
      setError(mode === "edit" ? "Failed to update template" : "Failed to create template")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="space-y-6">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {/* Template Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Template Name *
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Weekly Report Template"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            placeholder="Describe when and how to use this template"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Category
          </label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="CUSTOM">Custom</option>
            <option value="PROBLEM_DEFINITION">Problem Definition</option>
            <option value="SOLUTION_DESIGN">Solution Design</option>
            <option value="EXECUTION_TRACKING">Execution Tracking</option>
            <option value="RETROSPECTIVE_SUMMARY">Retrospective Summary</option>
          </select>
        </div>

        {/* Template Content */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Template Content (Markdown) *
          </label>
          <textarea
            required
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            rows={20}
            placeholder="# Template Title&#10;&#10;## Section 1&#10;Your content here...&#10;&#10;## Section 2&#10;More content..."
          />
          <p className="mt-2 text-sm text-gray-500">
            Use Markdown syntax. Supports headings, lists, tables, code blocks, etc.
          </p>
        </div>

        {/* Public Template */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isPublic"
            checked={formData.isPublic}
            onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="isPublic" className="text-sm font-medium text-gray-700">
            Make this template public (visible to all team members)
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (mode === "edit" ? "Saving..." : "Creating...") : mode === "edit" ? "Save Template" : "Create Template"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
