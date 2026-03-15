"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { TaskList } from "@/components/tasks/task-list"
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog"
import { TaskOperationsSnapshot } from "@/components/tasks/task-operations-snapshot"
import { AgentQueueStatus } from "@/components/tasks/agent-queue-status"
import { AgentQueueConsole } from "@/components/tasks/agent-queue-console"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { ExportTasksReportButton } from "@/components/tasks/export-tasks-report-button"
import { SaveTasksReportButton } from "@/components/tasks/save-tasks-report-button"
import { ExportAgentQueueStatusButton } from "@/components/reports/export-agent-queue-status-button"
import { SaveAgentQueueStatusButton } from "@/components/reports/save-agent-queue-status-button"
import { ExportOperationsStatusButton } from "@/components/reports/export-operations-status-button"
import { SaveOperationsStatusButton } from "@/components/reports/save-operations-status-button"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"
import { Filter, Plus, Search } from "lucide-react"

interface Project {
  id: string
  name: string
  teamId: string
}

const PROJECTS_FETCH_TIMEOUT_MS = 8000
const PROJECTS_FETCH_MAX_RETRIES = 2

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function TasksContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [refreshingProjects, setRefreshingProjects] = useState(false)
  const [reviewQueueCount, setReviewQueueCount] = useState(0)

  const [selectedProject, setSelectedProject] = useState<string>(
    searchParams.get("projectId") || ""
  )
  const [selectedStatus, setSelectedStatus] = useState<string>(
    searchParams.get("status") || searchParams.get("taskStatus") || ""
  )
  const [sourceFileId, setSourceFileId] = useState<string>(
    searchParams.get("sourceFileId") || ""
  )
  const [searchQuery, setSearchQuery] = useState("")
  const hasProjects = projects.length > 0
  const showProjectOnboarding = !loading && !projectsError && !hasProjects

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    const statusFromUrl = searchParams.get("status") || ""
    const taskStatusFromUrl = searchParams.get("taskStatus") || ""
    const effectiveStatus = taskStatusFromUrl || statusFromUrl
    if (!effectiveStatus) return
    if (statusFromUrl === effectiveStatus && taskStatusFromUrl === effectiveStatus) return
    updateUrl({
      projectId: searchParams.get("projectId") || undefined,
      status: effectiveStatus,
      taskStatus: effectiveStatus,
      sourceFileId: searchParams.get("sourceFileId") || undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    const fetchReviewQueueCount = async () => {
      if (!hasProjects) {
        setReviewQueueCount(0)
        return
      }
      try {
        const params = new URLSearchParams()
        params.set("status", "REVIEW")
        if (selectedProject) params.set("projectId", selectedProject)
        const response = await fetchWithTimeoutRetry(`/api/tasks?${params.toString()}`)
        if (!response.ok) {
          setReviewQueueCount(0)
          return
        }
        const payload = await response.json().catch(() => [])
        if (Array.isArray(payload)) {
          setReviewQueueCount(payload.length)
          return
        }
        if (payload && typeof payload === "object" && Array.isArray((payload as { tasks?: unknown[] }).tasks)) {
          setReviewQueueCount((payload as { tasks: unknown[] }).tasks.length)
          return
        }
        setReviewQueueCount(0)
      } catch {
        setReviewQueueCount(0)
      }
    }

    fetchReviewQueueCount().catch(() => undefined)
  }, [selectedProject, hasProjects])

  const fetchProjects = async (background = false) => {
    try {
      if (background) {
        setRefreshingProjects(true)
      } else {
        setLoading(true)
      }
      setProjectsError(null)

      let res: Response | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt <= PROJECTS_FETCH_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), PROJECTS_FETCH_TIMEOUT_MS)
        try {
          res = await fetch("/api/projects", { signal: controller.signal })
          window.clearTimeout(timeout)
          break
        } catch (error) {
          window.clearTimeout(timeout)
          lastError = error
          if (attempt < PROJECTS_FETCH_MAX_RETRIES) {
            await sleep(300 * (attempt + 1))
          }
        }
      }

      if (!res) {
        throw lastError instanceof Error ? lastError : new Error("Failed to fetch projects")
      }
      if (res.ok) {
        const data = await res.json()
        setProjects(data)
      } else {
        const payload = await res.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch projects"))
      }
    } catch (error) {
      setProjectsError(
        error instanceof Error
          ? error.message
          : "Failed to fetch projects. Please retry in a few seconds."
      )
    } finally {
      if (background) {
        setRefreshingProjects(false)
      } else {
        setLoading(false)
      }
    }
  }

  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId)
    updateUrl({
      projectId: projectId || undefined,
      status: selectedStatus || undefined,
      taskStatus: selectedStatus || undefined,
      sourceFileId: sourceFileId || undefined
    })
  }

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status)
    updateUrl({
      status: status || undefined,
      taskStatus: status || undefined,
      sourceFileId: sourceFileId || undefined
    })
  }

  const updateUrl = (params: Record<string, string | undefined>) => {
    const newParams = new URLSearchParams(searchParams.toString())
    const upsert = (key: string, value?: string) => {
      if (value) newParams.set(key, value)
      else newParams.delete(key)
    }
    upsert("projectId", params.projectId)
    upsert("status", params.status)
    upsert("taskStatus", params.taskStatus)
    upsert("sourceFileId", params.sourceFileId)
    const query = newParams.toString()
    router.push(query ? `/tasks?${query}` : "/tasks")
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-gray-600 mt-1">Manage and track your tasks</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasProjects ? (
            <>
              <ExportTasksReportButton
                defaultSourceProjectId={selectedProject || undefined}
                defaultStatus={selectedStatus || undefined}
              />
              <SaveTasksReportButton
                defaultTargetProjectId={selectedProject || undefined}
                defaultSourceProjectId={selectedProject || undefined}
                defaultStatus={selectedStatus || undefined}
              />
              <ExportAgentQueueStatusButton defaultSourceProjectId={selectedProject || undefined} />
              <SaveAgentQueueStatusButton
                defaultTargetProjectId={selectedProject || undefined}
                defaultSourceProjectId={selectedProject || undefined}
              />
              <ExportOperationsStatusButton defaultSourceProjectId={selectedProject || undefined} />
              <SaveOperationsStatusButton
                defaultTargetProjectId={selectedProject || undefined}
                defaultSourceProjectId={selectedProject || undefined}
              />
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Create Task
              </button>
            </>
          ) : (
            <>
              <Link
                href="/teams"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Create Team
              </Link>
              <Link
                href="/projects"
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Project
              </Link>
            </>
          )}
        </div>
      </div>

      {showProjectOnboarding ? (
        <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
          <div className="mb-4 text-6xl">🧭</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">No accessible projects yet</h2>
          <p className="mx-auto mb-6 max-w-xl text-gray-600">
            Tasks belong to projects. Create or join a project first, then assign work to humans or agents.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/teams"
              className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
            >
              Go to Teams
            </Link>
            <Link
              href="/projects"
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
            >
              Go to Projects
            </Link>
          </div>
        </div>
      ) : (
        <>
          <TaskOperationsSnapshot projectId={selectedProject || undefined} />
          <AgentQueueStatus projectId={selectedProject || undefined} />
          <OperationsHealthBanner projectId={selectedProject || undefined} />
          <OperationsStatusPanel projectId={selectedProject || undefined} />
          <AgentQueueConsole projectId={selectedProject || undefined} />

          <div className="bg-white rounded-lg shadow p-4 mb-6">
            {reviewQueueCount > 0 && selectedStatus !== "REVIEW" && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center justify-between gap-3">
                <span>
                  Review Queue has {reviewQueueCount} pending task{reviewQueueCount > 1 ? "s" : ""}.
                </span>
                <button
                  type="button"
                  aria-label="Open review queue"
                  onClick={() => handleStatusChange("REVIEW")}
                  className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  Open Review Queue
                </button>
              </div>
            )}
            {projectsError && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {projectsError}
              </div>
            )}
            <div className="flex flex-wrap gap-4 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={selectedProject}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => fetchProjects(true).catch(() => undefined)}
                  disabled={loading || refreshingProjects}
                  className="rounded border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading || refreshingProjects ? "Refreshing..." : "Refresh Projects"}
                </button>
              </div>

              <select
                value={selectedStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="REVIEW">Review</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {sourceFileId && (
            <div className="mb-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 flex items-center justify-between">
              <span>Filtered by source markdown file.</span>
              <button
                type="button"
                onClick={() => {
                  setSourceFileId("")
                  updateUrl({
                    projectId: selectedProject || undefined,
                    status: selectedStatus || undefined,
                    taskStatus: selectedStatus || undefined,
                    sourceFileId: undefined
                  })
                }}
                className="text-blue-700 hover:text-blue-900"
              >
                Clear
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <TaskList projectId={selectedProject} sourceFileId={sourceFileId || undefined} />
          )}

          {showCreateDialog && (
            <TaskCreateDialog
              isOpen={showCreateDialog}
              onClose={() => setShowCreateDialog(false)}
              projectId={selectedProject}
            />
          )}
        </>
      )}
    </>
  )
}

export function TasksPageClient() {
  return (
    <div className="p-6">
      <Suspense
        fallback={
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        }
      >
        <TasksContent />
      </Suspense>
    </div>
  )
}
