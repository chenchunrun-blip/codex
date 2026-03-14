"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { fetchProjectOptionsCached, type ProjectOption } from "@/lib/reports/project-options-cache"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"
import { AgentQueueStatus } from "@/components/tasks/agent-queue-status"
import { TaskOperationsSnapshot } from "@/components/tasks/task-operations-snapshot"
import { ExportOperationsStatusButton } from "@/components/reports/export-operations-status-button"
import { SaveOperationsStatusButton } from "@/components/reports/save-operations-status-button"
import { ExportAgentQueueStatusButton } from "@/components/reports/export-agent-queue-status-button"
import { SaveAgentQueueStatusButton } from "@/components/reports/save-agent-queue-status-button"

function OperationsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") || "")

  const hasProjects = projects.length > 0

  useEffect(() => {
    const nextProjectId = searchParams.get("projectId") || ""
    setSelectedProjectId(nextProjectId)
  }, [searchParams])

  const updateProjectFilter = (projectId: string) => {
    setSelectedProjectId(projectId)
    const params = new URLSearchParams(searchParams.toString())
    if (projectId) {
      params.set("projectId", projectId)
    } else {
      params.delete("projectId")
    }
    const query = params.toString()
    router.replace(query ? `/operations?${query}` : "/operations")
  }

  const loadProjects = async (forceRefresh = false) => {
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const items = await fetchProjectOptionsCached({ forceRefresh })
      setProjects(items)
      if (items.length === 0) {
        setSelectedProjectId("")
        return
      }
      if (selectedProjectId && !items.some((item) => item.id === selectedProjectId)) {
        updateProjectFilter("")
      }
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : "Failed to load projects")
      setProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }

  useEffect(() => {
    loadProjects().catch(() => undefined)
  }, [])

  const scopeProjectId = selectedProjectId || undefined

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations</h1>
          <p className="mt-1 text-gray-600">
            Unified runtime visibility for queue, scheduler, and report pipelines.
          </p>
        </div>
        {hasProjects ? (
          <div className="flex flex-wrap items-center gap-2">
            <ExportOperationsStatusButton defaultSourceProjectId={scopeProjectId} />
            <SaveOperationsStatusButton
              defaultTargetProjectId={scopeProjectId}
              defaultSourceProjectId={scopeProjectId}
            />
            <ExportAgentQueueStatusButton defaultSourceProjectId={scopeProjectId} />
            <SaveAgentQueueStatusButton
              defaultTargetProjectId={scopeProjectId}
              defaultSourceProjectId={scopeProjectId}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>

      {projectsError && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {projectsError}
        </div>
      )}

      {hasProjects && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
          <label htmlFor="operations-project-scope" className="text-sm font-medium text-gray-700">
            Scope
          </label>
          <select
            id="operations-project-scope"
            value={selectedProjectId}
            onChange={(event) => updateProjectFilter(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            disabled={loadingProjects}
          >
            <option value="">All Accessible Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadProjects(true).catch(() => undefined)}
            disabled={loadingProjects}
            className="rounded border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingProjects ? "Refreshing..." : "Refresh Projects"}
          </button>
        </div>
      )}

      {!loadingProjects && !hasProjects ? (
        <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
          <div className="mb-4 text-6xl">🧭</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">No accessible projects yet</h2>
          <p className="mx-auto mb-6 max-w-xl text-gray-600">
            Operations metrics need project data. Create or join a project to unlock queue and scheduler
            observability.
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
          <OperationsHealthBanner projectId={scopeProjectId} />
          <OperationsStatusPanel projectId={scopeProjectId} />
          <AgentQueueStatus projectId={scopeProjectId} />
          <TaskOperationsSnapshot projectId={scopeProjectId} />
        </>
      )}
    </div>
  )
}

export function OperationsPageClient() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      }
    >
      <OperationsContent />
    </Suspense>
  )
}
