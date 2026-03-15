"use client"

import { TeamMembers } from "./team-members"
import { ProjectBulkStarterPackPanel } from "@/components/project/project-bulk-starter-pack-panel"
import { TeamStarterPackHistoryPanel } from "./team-starter-pack-history-panel"
import { ExportTeamWorkspaceReportButton } from "./export-team-workspace-report-button"
import { SaveTeamWorkspaceReportButton } from "./save-team-workspace-report-button"
import { TeamTemplateQuickUse } from "./team-template-quick-use"
import { TeamTemplateRolloutButton } from "./team-template-rollout-button"
import { SaveTeamRolloutHistoryButton } from "./save-team-rollout-history-button"
import { SaveTeamRolloutSummaryButton } from "./save-team-rollout-summary-button"

interface Team {
  id: string
  name: string
  description: string | null
  creator: {
    id: string
    name: string | null
    email: string
  }
  members: Array<{
    id: string
    role: 'ADMIN' | 'MEMBER'
    user: {
      id: string
      name: string | null
      email: string
      avatar: string | null
    }
  }>
  projects: Array<{
    id: string
    name: string
    description: string | null
    status: string
    creator: {
      name: string | null
    }
  }>
  recommendedTemplates?: Array<{
    id: string
    name: string
    category: string
    description: string | null
    isBuiltIn: boolean
  }>
  overview?: {
    projectCount: number
    fileCount: number
    openTaskCount: number
    dueSoonTaskCount: number
    overdueTaskCount: number
  }
  currentUserRole: 'ADMIN' | 'MEMBER'
}

interface TeamDetailViewProps {
  team: Team
}

export function TeamDetailView({ team }: TeamDetailViewProps) {
  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{team.name}</h1>
            {team.description && (
              <p className="text-gray-600 mt-2">{team.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SaveTeamWorkspaceReportButton
              teamId={team.id}
              projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
            />
            <ExportTeamWorkspaceReportButton
              team={{
                id: team.id,
                name: team.name,
                description: team.description,
                creatorName: team.creator.name || team.creator.email,
                overview: {
                  projectCount: team.overview?.projectCount || 0,
                  fileCount: team.overview?.fileCount || 0,
                  openTaskCount: team.overview?.openTaskCount || 0,
                  dueSoonTaskCount: team.overview?.dueSoonTaskCount || 0,
                  overdueTaskCount: team.overview?.overdueTaskCount || 0
                },
                projects: team.projects.map((project) => ({
                  id: project.id,
                  name: project.name,
                  status: project.status
                })),
                recommendedTemplates: (team.recommendedTemplates || []).map((template) => ({
                  id: template.id,
                  name: template.name,
                  category: template.category,
                  isBuiltIn: template.isBuiltIn
                }))
              }}
            />
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Created by {team.creator.name || team.creator.email}
        </p>
      </div>

      {/* Team Members */}
      <div className="mb-8">
        <TeamMembers
          teamId={team.id}
          members={team.members}
          currentUserRole={team.currentUserRole}
          onUpdate={() => {
            // Trigger page refresh
            window.location.reload()
          }}
        />
      </div>

      {/* Team Overview */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Team Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Projects</div>
            <div className="text-xl font-semibold text-gray-900">{team.overview?.projectCount || 0}</div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Files</div>
            <div className="text-xl font-semibold text-gray-900">{team.overview?.fileCount || 0}</div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">Open Tasks</div>
            <div className="text-xl font-semibold text-gray-900">{team.overview?.openTaskCount || 0}</div>
          </div>
          <div className="rounded border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs text-amber-700">Due ≤ 3d</div>
            <div className="text-xl font-semibold text-amber-800">{team.overview?.dueSoonTaskCount || 0}</div>
          </div>
          <div className="rounded border border-red-200 bg-red-50 p-4">
            <div className="text-xs text-red-700">Overdue</div>
            <div className="text-xl font-semibold text-red-800">{team.overview?.overdueTaskCount || 0}</div>
          </div>
        </div>
      </div>

      {team.currentUserRole === "ADMIN" && team.projects.length > 0 && (
        <div className="mb-8">
          <ProjectBulkStarterPackPanel
            projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
            title="Team Starter Pack Rollout"
            description="Preview or apply starter packs across all projects in this team."
            historyKey={`bulk-starter-pack-runner-history-team-${team.id}`}
            endpoint={`/api/teams/${team.id}/starter-files/apply-pack`}
            onCompleted={() => {
              window.dispatchEvent(new CustomEvent(`team-rollout-updated:${team.id}`))
            }}
          />
          <div className="mt-3 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <SaveTeamRolloutSummaryButton
                teamId={team.id}
                projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
              />
              <SaveTeamRolloutHistoryButton
                teamId={team.id}
                projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
              />
            </div>
          </div>
          <div className="mt-3">
            <TeamStarterPackHistoryPanel teamId={team.id} />
          </div>
        </div>
      )}

      {/* Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Projects</h2>
        </div>

        {team.projects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No projects yet. Create your first project to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {team.projects.map((project) => (
              <a
                key={project.id}
                href={`/projects/${project.id}`}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <h3 className="font-semibold text-gray-900 mb-2">{project.name}</h3>
                {project.description && (
                  <p className="text-sm text-gray-600 mb-3">{project.description}</p>
                )}
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Created by {project.creator.name}</span>
                  <span className={`px-2 py-1 rounded-full ${
                    project.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                    project.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {project.status}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Recommended Templates */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Recommended Templates</h2>
          <a href="/templates" className="text-sm text-blue-600 hover:text-blue-700">
            View all templates →
          </a>
        </div>

        {(team.recommendedTemplates || []).length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-sm text-gray-500">
            No recommendation signal yet. Create files from templates in this team to improve recommendations.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(team.recommendedTemplates || []).map((template) => (
              <div
                key={template.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{template.name}</h3>
                  {template.isBuiltIn && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Built-in
                    </span>
                  )}
                </div>
                <div className="mt-2 text-xs text-blue-700">{template.category}</div>
                {template.description && (
                  <p className="mt-2 text-sm text-gray-600 line-clamp-2">{template.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <a
                    href={`/templates?category=${template.category}`}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Open in Template Center
                  </a>
                  <div className="flex items-center gap-2">
                    <TeamTemplateQuickUse
                      templateId={template.id}
                      templateName={template.name}
                      projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
                    />
                    {team.currentUserRole === "ADMIN" && team.projects.length > 0 && (
                      <TeamTemplateRolloutButton
                        teamId={team.id}
                        templateId={template.id}
                        templateName={template.name}
                        projects={team.projects.map((project) => ({ id: project.id, name: project.name }))}
                        onCompleted={() => {
                          window.dispatchEvent(new CustomEvent(`team-rollout-updated:${team.id}`))
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
