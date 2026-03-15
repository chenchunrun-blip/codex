"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"
import { clearStarterPackOptionsCache } from "@/lib/reports/starter-pack-options-cache"
import { clearTemplateOptionsCache } from "@/lib/reports/template-options-cache"

interface Template {
  id: string
  name: string
  description: string | null
  category: string
  content: string
  isBuiltIn: boolean
  creator: {
    id: string
    name: string | null
    email: string
  } | null
  usageCount?: number
  lastUsedAt?: string | null
  canManage?: boolean
}

const categoryLabels: Record<string, string> = {
  PROBLEM_DEFINITION: "Problem Definition",
  SOLUTION_DESIGN: "Solution Design",
  EXECUTION_TRACKING: "Execution Tracking",
  RETROSPECTIVE_SUMMARY: "Retrospective Summary",
  CUSTOM: "Custom"
}

const categoryIcons: Record<string, string> = {
  PROBLEM_DEFINITION: "🔍",
  SOLUTION_DESIGN: "💡",
  EXECUTION_TRACKING: "📊",
  RETROSPECTIVE_SUMMARY: "📝",
  CUSTOM: "📄"
}

export function TemplateCard({ template }: { template: Template }) {
  const [copied, setCopied] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [applyResults, setApplyResults] = useState<
    Array<{
      projectId: string
      ok: boolean
      createdCount: number
      wouldCreateCount: number
      skippedCount: number
      message: string
      fileId: string | null
    }>
  >([])
  const [dryRun, setDryRun] = useState(false)
  const [skipExistingByTemplateType, setSkipExistingByTemplateType] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const router = useRouter()

  const handleCopy = () => {
    navigator.clipboard.writeText(template.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUseTemplate = async () => {
    setIsLoading(true)
    setError("")
    setInfo("")

    try {
      const data = await fetchProjectOptionsCached()

      if (!Array.isArray(data) || data.length === 0) {
        setError("No projects found. Please create a project first.")
        return
      }

      setProjects(data)
      setSelectedProjectIds([data[0].id])
      setApplyResults([])
      setDryRun(false)
      setSkipExistingByTemplateType(true)
      setShowProjectDialog(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateFile = async () => {
    if (selectedProjectIds.length === 0) {
      setError("Please select at least one project")
      return
    }

    setIsLoading(true)
    setError("")
    setInfo("")

    try {
      const response = await fetch(`/api/templates/${template.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectIds: selectedProjectIds,
          dryRun,
          skipExistingByTemplateType
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(mapReportApiErrorFromPayload(payload, "Failed to apply template"))
        return
      }

      const results = Array.isArray(payload?.results) ? payload.results : []
      setApplyResults(results)
      const failed = results.filter((item: { ok?: boolean }) => !item.ok)
      const success = results.filter((item: { ok?: boolean }) => item.ok)
      if (success.length === 0) {
        setError(failed[0]?.message || "Failed to apply template")
        return
      }

      if (dryRun) {
        setInfo(
          `Preview complete: would create ${payload?.summary?.wouldCreateTotal || 0}, skipped ${payload?.summary?.skippedTotal || 0}, failed ${payload?.summary?.failed || 0}.`
        )
      } else if (failed.length > 0) {
        setInfo(
          `Created ${payload?.summary?.createdTotal || 0}/${results.length}. Failed: ${failed[0]?.message || "Unknown error"}`
        )
      } else {
        setInfo(`Created ${payload?.summary?.createdTotal || success.length} file(s).`)
      }

      if (!dryRun && failed.length === 0 && results.length === 1 && success[0]?.fileId) {
        setShowProjectDialog(false)
        router.push(`/editor/${success[0].fileId}`)
      } else if (!dryRun) {
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file")
    } finally {
      setIsLoading(false)
    }
  }

  const toggleSelectedProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)
    )
  }

  const handleDeleteTemplate = async () => {
    if (!template.canManage || isDeleting) return
    if (!confirm("Delete this template?")) return
    setIsDeleting(true)
    setError("")
    setInfo("")
    try {
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "DELETE"
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to delete template"))
      }
      clearTemplateOptionsCache()
      clearStarterPackOptionsCache()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportTemplate = () => {
    const safeName = template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "template"
    const markdown = [
      `# ${template.name}`,
      "",
      `- Category: ${template.category}`,
      `- Built-in: ${template.isBuiltIn ? "yes" : "no"}`,
      "",
      "## Description",
      template.description || "N/A",
      "",
      "## Template Content",
      "",
      template.content
    ].join("\n")
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${safeName}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const handleDuplicateTemplate = async () => {
    if (isDuplicating) return
    setIsDuplicating(true)
    setError("")
    setInfo("")
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${template.name} (Copy)`,
          description: template.description || `Copied from template ${template.name}`,
          category: template.category,
          content: template.content,
          isPublic: false
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to duplicate template"))
      }
      clearTemplateOptionsCache()
      clearStarterPackOptionsCache()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate template")
    } finally {
      setIsDuplicating(false)
    }
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{categoryIcons[template.category]}</span>
              <h3 className="text-lg font-semibold text-gray-900 break-words">{template.name}</h3>
            </div>
            <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
              {categoryLabels[template.category]}
            </span>
          </div>
          {template.isBuiltIn && (
            <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800 flex-shrink-0">
              Built-in
            </span>
          )}
        </div>

        {template.description && (
          <p className="text-sm text-gray-600 mb-4 line-clamp-2 break-words">{template.description}</p>
        )}

        {template.creator && (
          <p className="text-xs text-gray-500 mb-4 break-words">
            Created by <span className="break-all">{template.creator.name || template.creator.email}</span>
          </p>
        )}

        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
          <span className="rounded bg-gray-100 px-2 py-1">
            Used {template.usageCount || 0} time{(template.usageCount || 0) === 1 ? "" : "s"}
          </span>
          {template.lastUsedAt && (
            <span className="rounded bg-gray-100 px-2 py-1">
              Last used {new Date(template.lastUsedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowPreviewDialog(true)}
            className="flex-1 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            Preview
          </button>
          <button
            onClick={handleCopy}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              copied
                ? "bg-green-100 text-green-800"
                : "text-gray-700 bg-gray-100 hover:bg-gray-200"
            }`}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleUseTemplate}
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? "Loading..." : "Use Template"}
          </button>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={handleDuplicateTemplate}
            disabled={isDuplicating}
            className="w-full px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
          >
            {isDuplicating ? "Duplicating..." : "Duplicate as Custom"}
          </button>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={handleExportTemplate}
            className="w-full px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100"
          >
            Export as Markdown
          </button>
        </div>
        {template.canManage && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/templates/${template.id}/edit`)}
              className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDeleteTemplate}
              disabled={isDeleting}
              className="flex-1 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        )}
      </div>

      {/* Project Selection Dialog */}
      {showProjectDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900 break-words">Select Project(s)</h2>
              <p className="text-sm text-gray-500 mt-1 break-words">
                Choose one or more projects to create files from this template
              </p>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
                  {error}
                </div>
              )}
              {info && (
                <div className="p-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded">
                  {info}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Projects
                </label>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-300 p-2">
                  {projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 px-1 py-1 text-sm text-gray-700 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={(e) => toggleSelectedProject(project.id, e.target.checked)}
                      />
                      <span className="break-all">{project.name}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Selected {selectedProjectIds.length} / {projects.length}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={skipExistingByTemplateType}
                  onChange={(e) => setSkipExistingByTemplateType(e.target.checked)}
                />
                Skip projects that already have this template type
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                Dry run preview only
              </label>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowProjectDialog(false)
                    setError("")
                    setInfo("")
                    setApplyResults([])
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFile}
                  disabled={isLoading || selectedProjectIds.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isLoading
                    ? "Creating..."
                    : dryRun
                      ? "Preview Bulk Apply"
                    : selectedProjectIds.length > 1
                      ? `Create ${selectedProjectIds.length} Files`
                      : "Create File"}
                </button>
              </div>

              {applyResults.length > 0 && (
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-gray-700">Latest Apply Results</div>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {applyResults.map((item) => {
                      const projectName =
                        projects.find((project) => project.id === item.projectId)?.name || item.projectId
                      const statusText = item.ok ? "OK" : "FAILED"
                      const detail = dryRun
                        ? `wouldCreate=${item.wouldCreateCount}, skipped=${item.skippedCount}`
                        : `created=${item.createdCount}, skipped=${item.skippedCount}`
                      return (
                        <div key={`${item.projectId}-${item.message}`} className="text-xs text-gray-700">
                          <span className={`mr-1 rounded px-1 py-0.5 text-[10px] ${
                            item.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}>
                            {statusText}
                          </span>
                          {projectName}: {item.message} ({detail})
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Template Preview Dialog */}
      {showPreviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 break-words">{template.name}</h2>
                <p className="text-xs text-gray-500">{categoryLabels[template.category] || template.category}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPreviewDialog(false)
                    handleUseTemplate().catch(() => undefined)
                  }}
                  className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Use Template
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreviewDialog(false)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-800">
                {template.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
