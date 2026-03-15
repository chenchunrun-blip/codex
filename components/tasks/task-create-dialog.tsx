"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { taskSpecMarkdownSchema } from "@/lib/utils/validation"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"

interface Project {
  id: string
  name: string
}

interface User {
  id: string
  name: string | null
  email: string
}

interface Agent {
  id: string
  name: string
  displayName: string
  isActive: boolean
}

interface TaskCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId?: string
}

const OPTIONS_FETCH_TIMEOUT_MS = 8000
const OPTIONS_FETCH_MAX_RETRIES = 2

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function TaskCreateDialog({ isOpen, onClose, projectId }: TaskCreateDialogProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [optionsError, setOptionsError] = useState("")
  const [specErrors, setSpecErrors] = useState<string[]>([])
  const [specScore, setSpecScore] = useState<number>(0)
  const [specWarnings, setSpecWarnings] = useState<string[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [agents, setAgents] = useState<Agent[]>([])

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    projectId: projectId || "",
    assigneeId: "",
    agentId: "",
    assigneeType: "HUMAN",
    agentQueueType: "ENGINEERING",
    assignmentMode: "MANUAL",
    priority: "MEDIUM",
    dueDate: "",
  })
  const [specData, setSpecData] = useState({
    goal: "",
    deliverables: "",
    requirements: "",
    acceptanceCriteria: "",
    priority: "HIGH",
    dueDate: ""
  })

  useEffect(() => {
    if (isOpen) {
      fetchProjects()
      fetchUsers()
      fetchAgents()
    }
  }, [isOpen])

  const fetchJsonWithRetry = async <T,>(url: string, fallback: string): Promise<T> => {
    let response: Response | null = null
    let lastError: unknown = null

    for (let attempt = 0; attempt <= OPTIONS_FETCH_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), OPTIONS_FETCH_TIMEOUT_MS)
      try {
        response = await fetch(url, { signal: controller.signal })
        window.clearTimeout(timeout)
        break
      } catch (err) {
        window.clearTimeout(timeout)
        lastError = err
        if (attempt < OPTIONS_FETCH_MAX_RETRIES) {
          await sleep(300 * (attempt + 1))
        }
      }
    }

    if (!response) {
      throw lastError instanceof Error ? lastError : new Error(fallback)
    }

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(mapReportApiErrorFromPayload(payload, fallback))
    }
    return payload as T
  }

  const fetchProjects = async () => {
    try {
      const data = await fetchJsonWithRetry<Project[]>("/api/projects", "Failed to load projects")
      setProjects(Array.isArray(data) ? data : [])
    } catch (err) {
      try {
        const cachedProjects = await fetchProjectOptionsCached()
        if (cachedProjects.length > 0) {
          setProjects(cachedProjects)
          setOptionsError(
            err instanceof Error
              ? `${err.message}. Showing cached project list.`
              : "Failed to load projects. Showing cached project list."
          )
          return
        }
      } catch {
        // ignore cache fallback errors
      }
      setOptionsError(err instanceof Error ? err.message : "Failed to load projects")
    }
  }

  const fetchUsers = async () => {
    try {
      const data = await fetchJsonWithRetry<User[]>("/api/users", "Failed to load users")
      setUsers(Array.isArray(data) ? data : [])
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "Failed to load users")
    }
  }

  const fetchAgents = async () => {
    try {
      const data = await fetchJsonWithRetry<{ agents?: Agent[] }>("/api/agents", "Failed to load agents")
      setAgents((data.agents || []).filter((agent: Agent) => agent.isActive))
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "Failed to load agents")
    }
  }

  const buildSpecMarkdown = () => {
    const toList = (value: string) => {
      const lines = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      return lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- (to be filled)"
    }

    return `# TaskSpec

## Goal
${toList(specData.goal)}

## Deliverables
${toList(specData.deliverables)}

## Requirements
${toList(specData.requirements)}

## Acceptance Criteria
${toList(specData.acceptanceCriteria)}

## Priority
- ${specData.priority}

## Due Date
- ${specData.dueDate || "TBD"}`
  }

  const validateSpec = (markdown: string) => {
    const parsed = taskSpecMarkdownSchema.safeParse(markdown)
    if (!parsed.success) {
      setSpecErrors(parsed.error.issues.map((issue) => issue.message))
      return false
    }
    setSpecErrors([])
    return true
  }

  useEffect(() => {
    const markdown = buildSpecMarkdown()
    validateSpec(markdown)
    const lint = lintTaskSpecMarkdown(markdown)
    setSpecScore(lint.score)
    setSpecWarnings(lint.issues.filter((item) => item.level === "warning").map((item) => item.message).slice(0, 4))
  }, [specData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setOptionsError("")
    setIsLoading(true)

    try {
      if (!formData.projectId) {
        setError("Please select a project")
        return
      }

      const specMarkdown = buildSpecMarkdown()
      if (!validateSpec(specMarkdown)) {
        setError("TaskSpec is incomplete. Please fill all required sections.")
        return
      }

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description || undefined,
          projectId: formData.projectId,
          specMarkdown,
          assigneeType: formData.assigneeType,
          assigneeId: formData.assigneeType === "HUMAN" ? (formData.assigneeId || undefined) : undefined,
          agentId: formData.assigneeType !== "HUMAN" ? (formData.agentId || undefined) : undefined,
          functionalAgentType: formData.assigneeType === "FUNCTIONAL_AGENT" ? formData.agentQueueType : undefined,
          assignmentMode: formData.assignmentMode,
          priority: formData.priority,
          dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(mapTaskApiErrorFromPayload(data, "Failed to create task"))
      } else {
        onClose()
        router.push(`/tasks/${data.id}`)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task")
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Create New Task</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {optionsError && (
            <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded">
              <div>{optionsError}</div>
              <button
                type="button"
                className="mt-2 text-xs underline"
                onClick={() => {
                  setOptionsError("")
                  fetchProjects()
                  fetchUsers()
                  fetchAgents()
                }}
              >
                Retry loading options
              </button>
            </div>
          )}
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              Title *
            </label>
            <input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Task title"
              required
              minLength={2}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe the task..."
              rows={3}
            />
          </div>

          <div>
            <label htmlFor="projectId" className="block text-sm font-medium text-gray-700 mb-2">
              Project *
            </label>
            <select
              id="projectId"
              value={formData.projectId}
              onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="assigneeType" className="block text-sm font-medium text-gray-700 mb-2">
                Assignee Type
              </label>
              <select
                id="assigneeType"
                value={formData.assigneeType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    assigneeType: e.target.value,
                    assigneeId: "",
                    agentId: ""
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="HUMAN">Human</option>
                <option value="AGENT">Agent</option>
                <option value="FUNCTIONAL_AGENT">Agent Queue</option>
              </select>
            </div>

            <div>
              <label htmlFor="assignmentMode" className="block text-sm font-medium text-gray-700 mb-2">
                Assignment Mode
              </label>
              <select
                id="assignmentMode"
                value={formData.assignmentMode}
                onChange={(e) => setFormData({ ...formData, assignmentMode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="MANUAL">MANUAL</option>
                <option value="AI_SUGGESTED">AI_SUGGESTED</option>
                <option value="AI_AUTO">AI_AUTO</option>
              </select>
            </div>
          </div>

          {formData.assigneeType === "HUMAN" && (
            <div>
              <label htmlFor="assigneeId" className="block text-sm font-medium text-gray-700 mb-2">
                Human Assignee (optional)
              </label>
              <select
                id="assigneeId"
                value={formData.assigneeId}
                onChange={(e) => setFormData({ ...formData, assigneeId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(formData.assigneeType === "AGENT" || formData.assigneeType === "FUNCTIONAL_AGENT") && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="agentId" className="block text-sm font-medium text-gray-700 mb-2">
                  Agent {formData.assigneeType === "FUNCTIONAL_AGENT" ? "(optional)" : "*"}
                </label>
                <select
                  id="agentId"
                  value={formData.agentId}
                  onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={formData.assigneeType === "AGENT"}
                >
                  <option value="">
                    {formData.assigneeType === "FUNCTIONAL_AGENT" ? "No fixed agent" : "Select agent"}
                  </option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName || agent.name}
                    </option>
                  ))}
                </select>
              </div>

              {formData.assigneeType === "FUNCTIONAL_AGENT" && (
                <div>
                  <label htmlFor="functionalAgentType" className="block text-sm font-medium text-gray-700 mb-2">
                    Agent Domain *
                  </label>
                  <select
                    id="functionalAgentType"
                    value={formData.agentQueueType}
                    onChange={(e) => setFormData({ ...formData, agentQueueType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="PRODUCT">PRODUCT</option>
                    <option value="ENGINEERING">ENGINEERING</option>
                    <option value="QA">QA</option>
                    <option value="DESIGN">DESIGN</option>
                    <option value="OPERATIONS">OPERATIONS</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-2">
                Priority
              </label>
              <select
                id="priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-2">
              Due Date
            </label>
            <input
              id="dueDate"
              type="datetime-local"
              value={formData.dueDate}
              onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">TaskSpec (Structured)</h3>
            <p className="text-xs text-gray-500">
              One line per bullet. This will be converted to `specMarkdown`.
            </p>
            <div className="text-xs flex items-center gap-2">
              <span className="font-medium text-gray-700">Quality score:</span>
              <span
                className={`px-2 py-0.5 rounded ${
                  specScore >= 80 ? "bg-green-100 text-green-700" : specScore >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                }`}
              >
                {specScore}/100
              </span>
            </div>
            {specWarnings.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                {specWarnings.map((msg, idx) => (
                  <div key={`${msg}-${idx}`}>- {msg}</div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Goal *</label>
              <textarea
                value={specData.goal}
                onChange={(e) => setSpecData({ ...specData, goal: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Describe goals, one per line"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deliverables *</label>
              <textarea
                value={specData.deliverables}
                onChange={(e) => setSpecData({ ...specData, deliverables: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="List deliverables, one per line"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Requirements *</label>
              <textarea
                value={specData.requirements}
                onChange={(e) => setSpecData({ ...specData, requirements: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="List requirements, one per line"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Acceptance Criteria *</label>
              <textarea
                value={specData.acceptanceCriteria}
                onChange={(e) => setSpecData({ ...specData, acceptanceCriteria: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="List acceptance criteria, one per line"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Spec Priority</label>
                <select
                  value={specData.priority}
                  onChange={(e) => setSpecData({ ...specData, priority: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Spec Due Date</label>
                <input
                  type="date"
                  value={specData.dueDate}
                  onChange={(e) => setSpecData({ ...specData, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Generated TaskSpec Preview</label>
              <pre className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white overflow-auto max-h-48 whitespace-pre-wrap">
                {buildSpecMarkdown()}
              </pre>
            </div>

            {specErrors.length > 0 && (
              <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded">
                {specErrors.map((msg, idx) => (
                  <div key={`${msg}-${idx}`}>{msg}</div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || specErrors.length > 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
