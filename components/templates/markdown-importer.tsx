"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { clearStarterPackOptionsCache } from "@/lib/reports/starter-pack-options-cache"
import { clearTemplateOptionsCache } from "@/lib/reports/template-options-cache"

interface MarkdownImporterProps {
  userId: string
}

export function MarkdownImporter({ userId }: MarkdownImporterProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState("")
  const [content, setContent] = useState("")
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "CUSTOM",
    isPublic: false
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.md')) {
      setError("Please select a markdown file (.md)")
      return
    }

    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setContent(text)
      // Auto-fill name from filename without extension
      const nameFromFileName = file.name.replace('.md', '').replace(/[-_]/g, ' ')
      setFormData({ ...formData, name: nameFromFileName })
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!content) {
      setError("Please select a markdown file first")
      return
    }

    setIsUploading(true)

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          content
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, "Failed to create template"))
        return
      }

      clearTemplateOptionsCache()
      clearStarterPackOptionsCache()
      router.push("/templates")
    } catch (error) {
      console.error("Upload error:", error)
      setError("Failed to create template")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {/* File Upload */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">1. Select Markdown File</h2>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            onChange={handleFileSelect}
            className="hidden"
          />
          {fileName ? (
            <div>
              <div className="text-4xl mb-2">📄</div>
              <p className="text-sm font-medium text-gray-900">{fileName}</p>
              <p className="text-xs text-gray-500 mt-1">
                {content.length} characters
              </p>
              <button
                type="button"
                onClick={() => {
                  setFileName("")
                  setContent("")
                  setFormData({ ...formData, name: "" })
                  if (fileInputRef.current) fileInputRef.current.value = ""
                }}
                className="mt-3 text-sm text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-2">📁</div>
              <p className="text-gray-600 mb-4">
                Drag and drop a markdown file here, or click to select
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Choose File
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Template Details */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">2. Configure Template</h2>

        <div className="space-y-4">
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
              placeholder="Template name"
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
              rows={2}
              placeholder="Describe when to use this template"
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
              Make this template public
            </label>
          </div>
        </div>
      </div>

      {/* Preview */}
      {content && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">3. Preview Content</h2>
          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto">
            <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono">
              {content.substring(0, 1000)}
              {content.length > 1000 && "\n\n... (truncated)"}
            </pre>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Total: {content.length} characters
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isUploading || !content}
          className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? "Creating Template..." : "Create Template"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
