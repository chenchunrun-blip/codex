import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import Link from "next/link"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { ProjectBulkSchedulerPanel } from "@/components/project/project-bulk-scheduler-panel"
import { ProjectBulkHistoryPanel } from "@/components/project/project-bulk-history-panel"
import { ProjectBulkStarterPackPanel } from "@/components/project/project-bulk-starter-pack-panel"
import { ProjectQuickStarterActions } from "@/components/project/project-quick-starter-actions"
import { ExportProjectsPortfolioButton } from "@/components/project/export-projects-portfolio-button"
import { SaveProjectsPortfolioButton } from "@/components/project/save-projects-portfolio-button"
import { ExportProjectStarterHistoryButton } from "@/components/reports/export-project-starter-history-button"
import { SaveProjectStarterHistoryButton } from "@/components/reports/save-project-starter-history-button"
import { ExportProjectStarterSummaryButton } from "@/components/reports/export-project-starter-summary-button"
import { SaveProjectStarterSummaryButton } from "@/components/reports/save-project-starter-summary-button"
import { deriveProjectsBottlenecksSummary } from "@/lib/tasks/projects-bottlenecks-summary"
import { ActionType, TaskStatus } from "@prisma/client"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"

function getMetadataType(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const type = (metadata as { type?: unknown }).type
  return typeof type === "string" ? type : null
}

type ProjectsPageProps = {
  searchParams?: Promise<{
    q?: string
    projectId?: string
    teamId?: string
    status?: string
    sort?: string
    page?: string
    limit?: string
  }>
}

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const params = (await searchParams) || {}
  const query = typeof params.q === "string" ? params.q.trim() : ""
  const selectedProjectId = typeof params.projectId === "string" ? params.projectId : ""
  const selectedTeamId = typeof params.teamId === "string" ? params.teamId : ""
  const selectedStatus = typeof params.status === "string" ? params.status : "ALL"
  const sort = typeof params.sort === "string" ? params.sort : "updated_desc"
  const pageRaw = typeof params.page === "string" ? Number(params.page) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1
  const limitRaw = typeof params.limit === "string" ? Number(params.limit) : 12
  const projectLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 6), 48) : 12

  const projects = await db.project.findMany({
    where: {
      members: {
        some: { userId: session.user.id }
      }
    },
    include: {
      team: true,
      members: {
        include: { user: true }
      },
      _count: {
        select: {
          files: true
        }
      }
    },
    orderBy: { updatedAt: 'desc' }
  })
  const teams = Array.from(
    new Map(projects.map((project) => [project.team.id, { id: project.team.id, name: project.team.name }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name))
  const hasProjects = projects.length > 0
  const filteredProjects = projects
    .filter((project) => {
      if (selectedTeamId && project.teamId !== selectedTeamId) return false
      if (selectedStatus !== "ALL" && project.status !== selectedStatus) return false
      if (!query) return true
      const q = query.toLowerCase()
      return (
        project.name.toLowerCase().includes(q) ||
        (project.description || "").toLowerCase().includes(q) ||
        project.team.name.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name)
      if (sort === "status_asc") return a.status.localeCompare(b.status)
      if (sort === "created_desc") return b.createdAt.getTime() - a.createdAt.getTime()
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })
  const pagedFilteredProjects = filteredProjects.slice((page - 1) * projectLimit, page * projectLimit)
  const hasMoreProjects = page * projectLimit < filteredProjects.length

  const projectIds = filteredProjects.map((project) => project.id)
  const retryConfigLogs = projectIds.length
    ? await db.activityLog.findMany({
        where: {
          projectId: { in: projectIds },
          taskId: null,
          action: ActionType.TASK_UPDATED
        },
        select: {
          projectId: true,
          metadata: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: Math.max(80, projectIds.length * 5)
      })
    : []
  const [agents, queueTaskRows, riskTasks, taskRunLogs] = projectIds.length
    ? await Promise.all([
        db.agent.findMany({
          where: { isActive: true },
          select: {
            capabilities: true,
            updatedAt: true
          }
        }),
        db.task.findMany({
          where: {
            projectId: { in: projectIds },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] }
          },
          select: {
            projectId: true
          }
        }),
        db.task.findMany({
          where: {
            projectId: { in: projectIds },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] }
          },
          select: {
            id: true,
            projectId: true,
            status: true,
            dueDate: true,
            assigneeType: true
          }
        }),
        db.activityLog.findMany({
          where: {
            projectId: { in: projectIds },
            taskId: { not: null },
            action: ActionType.TASK_UPDATED
          },
          orderBy: { createdAt: "desc" },
          take: Math.max(200, projectIds.length * 40),
          select: {
            taskId: true,
            metadata: true
          }
        })
      ])
    : [[], [], [], []]

  const onlineAgentsByDomain = new Map<string, number>()
  for (const agent of agents) {
    if (!isAgentOnline(agent.updatedAt) || !Array.isArray(agent.capabilities)) continue
    for (const capability of agent.capabilities) {
      if (typeof capability !== "string") continue
      const key = capability.trim().toUpperCase()
      if (!key) continue
      onlineAgentsByDomain.set(key, (onlineAgentsByDomain.get(key) || 0) + 1)
    }
  }
  const latestRunStatusByTask = new Map<string, "SUCCESS" | "FAILED">()
  for (const log of taskRunLogs) {
    if (!log.taskId || latestRunStatusByTask.has(log.taskId)) continue
    const type = getMetadataType(log.metadata)
    if (type === "AGENT_RUN_FAILED") latestRunStatusByTask.set(log.taskId, "FAILED")
    if (type === "AGENT_RUN_TRIGGERED") latestRunStatusByTask.set(log.taskId, "SUCCESS")
  }
  const queueCountMap = new Map<string, { projectId: string; functionalAgentType: string | null; count: number }>()
  for (const row of queueTaskRows) {
    const key = `${row.projectId}::UNSPECIFIED`
    const existing = queueCountMap.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    queueCountMap.set(key, {
      projectId: row.projectId,
      functionalAgentType: null,
      count: 1
    })
  }

  const projectBottlenecksSummary = deriveProjectsBottlenecksSummary({
    projectIds,
    queueRows: Array.from(queueCountMap.values()),
    riskTasks: riskTasks.map((task) => ({
      ...task,
      functionalAgentType: null,
      specMarkdown: null,
      latestRunStatus: latestRunStatusByTask.get(task.id) || null
    })),
    onlineAgentsByDomain
  })

  const retryPolicySourceMap = new Map<string, "project" | "default">()
  const dispatchPolicySourceMap = new Map<string, "project" | "default">()
  for (const log of retryConfigLogs) {
    if (!log.projectId) continue
    const metadataType = getMetadataType(log.metadata)
    if (!retryPolicySourceMap.has(log.projectId) && metadataType === "PROJECT_RETRYABLE_ERROR_CODES_UPDATED") {
      retryPolicySourceMap.set(log.projectId, "project")
    }
    if (!dispatchPolicySourceMap.has(log.projectId) && metadataType === "PROJECT_DISPATCH_POLICY_UPDATED") {
      dispatchPolicySourceMap.set(log.projectId, "project")
    }
  }
  const portfolioItems = filteredProjects.map((project) => {
    const summary = projectBottlenecksSummary.get(project.id)
    return {
      id: project.id,
      name: project.name,
      teamName: project.team.name,
      status: project.status,
      fileCount: project._count.files,
      memberCount: project.members.length,
      recommendationCount: summary?.recommendationCount || 0,
      atRiskDomainCount: summary?.atRiskDomainCount || 0,
      highRiskTaskCount: summary?.highRiskTaskCount || 0,
      updatedAt: project.updatedAt.toISOString()
    }
  })
  const defaultFilteredProjectId = selectedProjectId || filteredProjects[0]?.id || ""
  const buildProjectsHref = ({
    nextPage = page,
    nextLimit = projectLimit
  }: {
    nextPage?: number
    nextLimit?: number
  }) => {
    const nextParams = new URLSearchParams()
    if (query) nextParams.set("q", query)
    if (selectedProjectId) nextParams.set("projectId", selectedProjectId)
    if (selectedTeamId) nextParams.set("teamId", selectedTeamId)
    if (selectedStatus !== "ALL") nextParams.set("status", selectedStatus)
    if (sort !== "updated_desc") nextParams.set("sort", sort)
    if (nextLimit !== 12) nextParams.set("limit", String(nextLimit))
    if (nextPage > 1) nextParams.set("page", String(nextPage))
    return `/projects?${nextParams.toString()}`
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
            <p className="mt-2 text-gray-600">Organize and track your work</p>
          </div>
          <div className="flex items-center gap-3">
            {hasProjects ? (
              <>
                <ExportProjectsPortfolioButton projects={portfolioItems} />
                <SaveProjectsPortfolioButton sourceProjectIds={filteredProjects.map((project) => project.id)} />
                <ExportProjectStarterHistoryButton defaultSourceProjectId={defaultFilteredProjectId} />
                <SaveProjectStarterHistoryButton
                  defaultSourceProjectId={defaultFilteredProjectId}
                  defaultTargetProjectId={defaultFilteredProjectId}
                />
                <ExportProjectStarterSummaryButton defaultProjectId={defaultFilteredProjectId} />
                <SaveProjectStarterSummaryButton defaultProjectId={defaultFilteredProjectId} />
                <CreateProjectDialog />
              </>
            ) : (
              <>
                <Link
                  href="/teams"
                  className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Create Team
                </Link>
                <CreateProjectDialog />
              </>
            )}
          </div>
        </div>

        {hasProjects ? (
          <>
            <form className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Search projects..."
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <select
                  name="teamId"
                  defaultValue={selectedTeamId}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Teams</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <select
                  name="status"
                  defaultValue={selectedStatus}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="updated_desc">Recently Updated</option>
                  <option value="created_desc">Newest Created</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="status_asc">Status A-Z</option>
                </select>
                <select
                  name="limit"
                  defaultValue={String(projectLimit)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="6">6 / page</option>
                  <option value="12">12 / page</option>
                  <option value="24">24 / page</option>
                  <option value="48">48 / page</option>
                </select>
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Apply Filters
                </button>
              </div>
            </form>

            <OperationsHealthBanner projectId={selectedProjectId || undefined} />
            <OperationsStatusPanel projectId={selectedProjectId || undefined} />

            {filteredProjects.length > 0 && (
              <>
                <ProjectBulkStarterPackPanel
                  projects={filteredProjects.map((project) => ({
                    id: project.id,
                    name: project.name
                  }))}
                />
                <ProjectBulkSchedulerPanel
                  projects={filteredProjects.map((project) => ({
                    id: project.id,
                    name: project.name,
                    policySource: retryPolicySourceMap.get(project.id) === "project" ? "project" : "default"
                  }))}
                />
                <ProjectBulkHistoryPanel projectIds={filteredProjects.map((project) => project.id)} />
              </>
            )}

            {/* Projects Grid */}
            {pagedFilteredProjects.length > 0 ? (
              <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pagedFilteredProjects.map((project) => (
                  <div
                    key={project.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <Link href={`/projects/${project.id}`} className="text-xl font-semibold text-gray-900 hover:text-blue-700">
                          {project.name}
                        </Link>
                        {project.description && (
                          <p className="mt-2 text-sm text-gray-600 line-clamp-2">{project.description}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        project.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        project.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {project.status.toLowerCase()}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Team:</span>
                        <span className="font-medium text-gray-900">{project.team.name}</span>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Files:</span>
                        <span className="font-medium text-gray-900">{project._count.files}</span>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Members:</span>
                        <div className="flex items-center">
                          <div className="flex -space-x-2">
                            {project.members.slice(0, 3).map((member) => (
                              <div
                                key={member.id}
                                className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs border-2 border-white"
                                title={member.user.name || member.user.email}
                              >
                                {(member.user.name || member.user.email || "U").charAt(0).toUpperCase()}
                              </div>
                            ))}
                          </div>
                          {project.members.length > 3 && (
                            <span className="ml-2 text-gray-500">+{project.members.length - 3}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Retry Policy:</span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${
                              retryPolicySourceMap.get(project.id) === "project"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {retryPolicySourceMap.get(project.id) === "project" ? "Custom" : "Default"}
                          </span>
                          <span className="text-gray-300">·</span>
                          <Link
                            href={`/projects/${project.id}#agent-retry-policy`}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Configure
                          </Link>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Dispatch Policy:</span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${
                              dispatchPolicySourceMap.get(project.id) === "project"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {dispatchPolicySourceMap.get(project.id) === "project" ? "Custom" : "Default"}
                          </span>
                          <span className="text-gray-300">·</span>
                          <Link
                            href={`/projects/${project.id}#agent-dispatch-policy`}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Configure
                          </Link>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Bottlenecks:</span>
                        <div className="flex items-center gap-2">
                          <span className="rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
                            Actions {projectBottlenecksSummary.get(project.id)?.recommendationCount || 0}
                          </span>
                          <span className="rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
                            Domains {projectBottlenecksSummary.get(project.id)?.atRiskDomainCount || 0}
                          </span>
                          <span className="rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                            High Risk {projectBottlenecksSummary.get(project.id)?.highRiskTaskCount || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                      Updated {new Date(project.updatedAt).toLocaleDateString()}
                    </div>
                    <ProjectQuickStarterActions
                      projectId={project.id}
                      currentUserRole={
                        (project.members.find((member) => member.userId === session.user.id)?.role as
                          | "ADMIN"
                          | "EDITOR"
                          | "VIEWER") || "VIEWER"
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                {page > 1 ? (
                  <Link
                    href={buildProjectsHref({ nextPage: page - 1 })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Previous</span>
                )}
                {hasMoreProjects ? (
                  <Link
                    href={buildProjectsHref({ nextPage: page + 1 })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Next</span>
                )}
              </div>
              </>
            ) : (
              <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
                <div className="text-6xl mb-4">🔎</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {page > 1 ? "No projects on this page" : "No projects match your filters"}
                </h3>
                <p className="text-gray-600 mb-6">
                  {page > 1
                    ? "Try going to the previous page or lowering page size."
                    : "Try adjusting search keywords, team/status filters, or reset to view all projects."}
                </p>
                {page > 1 ? (
                  <Link
                    href={buildProjectsHref({ nextPage: Math.max(page - 1, 1) })}
                    className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                  >
                    Previous Page
                  </Link>
                ) : (
                  <Link
                    href="/projects"
                    className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                  >
                    Clear Filters
                  </Link>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <div className="text-6xl mb-4">🧭</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No accessible projects yet</h3>
            <p className="text-gray-600 mb-6">Create your first team and project to start collaborative delivery.</p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/teams"
                className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
              >
                Go to Teams
              </Link>
              <CreateProjectDialog />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
