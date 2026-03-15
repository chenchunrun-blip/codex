"use client"

import { ProjectMembers } from "./project-members"
import { ProjectSchedulerConfigPanel } from "./project-scheduler-config-panel"
import { ProjectRetryConfigPanel } from "./project-retry-config-panel"
import { ProjectDispatchPolicyPanel } from "./project-dispatch-policy-panel"
import { ProjectBottlenecksPanel } from "./project-bottlenecks-panel"
import { ProjectStarterFilesPanel } from "./project-starter-files-panel"
import { ProjectTemplateRecommendationsPanel } from "./project-template-recommendations-panel"
import { ActivityLog } from "@/components/activity/activity-log"
import { TaskOperationsSnapshot } from "@/components/tasks/task-operations-snapshot"
import Link from "next/link"
import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Project {
  id: string
  name: string
  description: string | null
  status: string
  team: {
    id: string
    name: string
  }
  creator: {
    id: string
    name: string | null
    email: string
  }
  members: Array<{
    id: string
    role: 'ADMIN' | 'EDITOR' | 'VIEWER'
    user: {
      id: string
      name: string | null
      email: string
      avatar: string | null
    }
  }>
  files: Array<{
    id: string
    name: string
    createdAt: Date
  }>
  currentUserRole: 'ADMIN' | 'EDITOR' | 'VIEWER'
}

interface ProjectDetailViewProps {
  project: Project
}

export function ProjectDetailView({ project }: ProjectDetailViewProps) {
  const [isExportingWorkspaceReport, setIsExportingWorkspaceReport] = useState(false)
  const [isSavingWorkspaceReport, setIsSavingWorkspaceReport] = useState(false)
  const [workspaceReportError, setWorkspaceReportError] = useState<string | null>(null)

  const exportWorkspaceReport = async () => {
    setWorkspaceReportError(null)
    setIsExportingWorkspaceReport(true)
    try {
      const response = await fetch(`/api/projects/${project.id}/workspace-report?format=markdown`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to generate workspace report"))
      }
      const markdown = await response.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `workspace-report-${project.name.replace(/\s+/g, "-").toLowerCase()}.md`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Workspace report export error:", error)
      setWorkspaceReportError(error instanceof Error ? error.message : "Failed to generate workspace report")
    } finally {
      setIsExportingWorkspaceReport(false)
    }
  }

  const saveWorkspaceReportAsFile = async () => {
    setWorkspaceReportError(null)
    setIsSavingWorkspaceReport(true)
    try {
      const response = await fetch(`/api/projects/${project.id}/workspace-report/save`, {
        method: "POST"
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to save workspace report"))
      }
      if (data?.file?.id) {
        window.location.href = `/editor/${data.file.id}`
        return
      }
      window.location.reload()
    } catch (error) {
      console.error("Workspace report save error:", error)
      setWorkspaceReportError(error instanceof Error ? error.message : "Failed to save workspace report")
    } finally {
      setIsSavingWorkspaceReport(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
              <Link href={`/teams/${project.team.id}`} className="hover:text-blue-600">
                {project.team.name}
              </Link>
              <span>/</span>
              <span>Project</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
            {project.description && (
              <p className="text-gray-600 mt-2">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveWorkspaceReportAsFile}
              disabled={isSavingWorkspaceReport}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isSavingWorkspaceReport ? "Saving..." : "Save Report as File"}
            </button>
            <button
              type="button"
              onClick={exportWorkspaceReport}
              disabled={isExportingWorkspaceReport}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isExportingWorkspaceReport ? "Exporting..." : "Export Workspace Report"}
            </button>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              project.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
              project.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {project.status}
            </span>
          </div>
        </div>
        {workspaceReportError && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {workspaceReportError}
          </div>
        )}
        <p className="text-sm text-gray-500 mt-2">
          Created by {project.creator.name || project.creator.email}
        </p>
      </div>

      {/* Project Members */}
      <div className="mb-8">
        <ProjectMembers
          projectId={project.id}
          members={project.members}
          currentUserRole={project.currentUserRole}
          onUpdate={() => {
            window.location.reload()
          }}
        />
      </div>

      {/* Project Agent Retry Config */}
      <div className="mb-8">
        <ProjectRetryConfigPanel
          projectId={project.id}
          currentUserRole={project.currentUserRole}
        />
      </div>

      {/* Project Scheduler Defaults */}
      <div className="mb-8">
        <ProjectSchedulerConfigPanel
          projectId={project.id}
          currentUserRole={project.currentUserRole}
        />
      </div>

      {/* Project Agent Dispatch Policy */}
      <div className="mb-8">
        <ProjectDispatchPolicyPanel
          projectId={project.id}
          currentUserRole={project.currentUserRole}
        />
      </div>

      {/* Project Starter Files */}
      <div className="mb-8">
        <ProjectStarterFilesPanel
          projectId={project.id}
          currentUserRole={project.currentUserRole}
        />
      </div>

      {/* Project Template Recommendations */}
      <div className="mb-8">
        <ProjectTemplateRecommendationsPanel
          projectId={project.id}
          currentUserRole={project.currentUserRole}
          onApplied={() => window.location.reload()}
        />
      </div>

      {/* Project Operations Snapshot */}
      <div className="mb-8">
        <TaskOperationsSnapshot projectId={project.id} />
      </div>

      {/* Project Bottlenecks */}
      <div className="mb-8">
        <ProjectBottlenecksPanel projectId={project.id} />
      </div>

      {/* Recent Files */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Recent Files</h2>
          <Link
            href={`/projects/${project.id}/files`}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            View all files →
          </Link>
        </div>

        {project.files.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500 mb-4">No files yet. Create your first file to get started.</p>
            <Link
              href={`/editor/new?projectId=${project.id}`}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Create File
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="divide-y divide-gray-200">
              {project.files.map((file) => (
                <a
                  key={file.id}
                  href={`/editor/${file.id}`}
                  className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                      📄
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-sm text-gray-500">
                        Created {new Date(file.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-gray-400">→</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div>
        <ActivityLog projectId={project.id} limit={10} />
      </div>
    </div>
  )
}
