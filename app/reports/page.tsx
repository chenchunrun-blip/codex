import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { SaveWorkspaceReportButton } from "@/components/dashboard/save-workspace-report-button"
import { SaveAgentWorkloadButton } from "@/components/agents/save-agent-workload-button"
import { SaveAgentQueueStatusButton } from "@/components/reports/save-agent-queue-status-button"
import { ExportWorkspaceReportButton } from "@/components/reports/export-workspace-report-button"
import { ExportAgentWorkloadButton } from "@/components/reports/export-agent-workload-button"
import { ExportAgentQueueStatusButton } from "@/components/reports/export-agent-queue-status-button"
import { SaveTemplatesCatalogButton } from "@/components/templates/save-templates-catalog-button"
import { ExportTemplatesCatalogHubButton } from "@/components/templates/export-templates-catalog-hub-button"
import { SaveStarterPacksButton } from "@/components/templates/save-starter-packs-button"
import { ExportStarterPacksHubButton } from "@/components/templates/export-starter-packs-hub-button"
import { SaveFilesInventoryButton } from "@/components/files/save-files-inventory-button"
import { ExportFilesInventoryHubButton } from "@/components/files/export-files-inventory-hub-button"
import { SaveTeamsOverviewButton } from "@/components/team/save-teams-overview-button"
import { ExportTeamsOverviewHubButton } from "@/components/team/export-teams-overview-hub-button"
import { SaveProjectsPortfolioButton } from "@/components/project/save-projects-portfolio-button"
import { ExportProjectsPortfolioHubButton } from "@/components/project/export-projects-portfolio-hub-button"
import { SaveTasksReportButton } from "@/components/tasks/save-tasks-report-button"
import { ExportTasksReportButton } from "@/components/tasks/export-tasks-report-button"
import { SaveReportsHistoryButton } from "@/components/reports/save-reports-history-button"
import { SaveProjectBottlenecksButton } from "@/components/reports/save-project-bottlenecks-button"
import { SaveFileLinkedTasksReportButton } from "@/components/reports/save-file-linked-tasks-report-button"
import { SaveProjectWorkspaceReportButton } from "@/components/reports/save-project-workspace-report-button"
import { ExportProjectWorkspaceReportButton } from "@/components/reports/export-project-workspace-report-button"
import { SaveTeamStarterHistoryButton } from "@/components/reports/save-team-starter-history-button"
import { SaveProjectStarterHistoryButton } from "@/components/reports/save-project-starter-history-button"
import { ExportProjectStarterHistoryButton } from "@/components/reports/export-project-starter-history-button"
import { SaveTeamWorkspaceReportHubButton } from "@/components/reports/save-team-workspace-report-hub-button"
import { ExportTeamWorkspaceReportHubButton } from "@/components/reports/export-team-workspace-report-hub-button"
import { ExportProjectBottlenecksButton } from "@/components/reports/export-project-bottlenecks-button"
import { SaveProjectStarterSummaryButton } from "@/components/reports/save-project-starter-summary-button"
import { SaveTeamStarterSummaryButton } from "@/components/reports/save-team-starter-summary-button"
import { ExportTeamStarterHistoryButton } from "@/components/reports/export-team-starter-history-button"
import { ExportProjectStarterSummaryButton } from "@/components/reports/export-project-starter-summary-button"
import { ExportTeamStarterSummaryButton } from "@/components/reports/export-team-starter-summary-button"
import { ExportFileLinkedTasksReportButton } from "@/components/reports/export-file-linked-tasks-report-button"
import { ExportReportsHistoryButton } from "@/components/reports/export-reports-history-button"
import { ExportOperationsStatusButton } from "@/components/reports/export-operations-status-button"
import { SaveOperationsStatusButton } from "@/components/reports/save-operations-status-button"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"
import { queryReportsHistoryPage } from "@/lib/reports/history-query"
import {
  REPORT_METADATA_TYPES,
  reportMetadataTypeLabel
} from "@/lib/reports/metadata"
import Link from "next/link"

type ReportsPageProps = {
  searchParams?: Promise<{
    q?: string
    type?: string
    projectId?: string
    page?: string
    limit?: string
  }>
}

const BULK_STARTER_TYPE = "PROJECT_BULK_STARTER_PACK_REPORT_SAVED"
const BULK_SCHEDULER_TYPE = "PROJECT_BULK_SCHEDULER_REPORT_SAVED"

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }
  const params = (await searchParams) || {}
  const q = typeof params.q === "string" ? params.q.trim().toLowerCase() : ""
  const typeFilter = typeof params.type === "string" ? params.type : ""
  const projectFilter = typeof params.projectId === "string" ? params.projectId : ""
  const pageRaw = typeof params.page === "string" ? Number(params.page) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1
  const limitRaw = typeof params.limit === "string" ? Number(params.limit) : 20
  const historyLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 10), 100) : 20
  const historyOffset = (page - 1) * historyLimit

  const memberships = await db.projectMember.findMany({
    where: { userId: session.user.id },
    select: {
      projectId: true,
      project: {
        select: {
          name: true
        }
      }
    }
  })
  const projectIds = memberships.map((item) => item.projectId)
  const projects = memberships
    .map((item) => ({ id: item.projectId, name: item.project.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const hasProjects = projects.length > 0
  const scopedProjectIds = projectFilter
    ? projectIds.filter((id) => id === projectFilter)
    : projectIds
  const reportHistoryResult = scopedProjectIds.length
    ? await queryReportsHistoryPage({
        projectIds: scopedProjectIds,
        typeFilter,
        q,
        limit: historyLimit,
        offset: historyOffset
      })
    : { history: [], hasMore: false }
  const reportHistory = reportHistoryResult.history
  const hasMoreHistory = reportHistoryResult.hasMore

  const buildReportsHref = ({
    nextPage = page,
    nextType = typeFilter,
    nextProjectId = projectFilter
  }: {
    nextPage?: number
    nextType?: string
    nextProjectId?: string
  }) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (nextType) params.set("type", nextType)
    if (nextProjectId) params.set("projectId", nextProjectId)
    if (historyLimit !== 20) params.set("limit", String(historyLimit))
    if (nextPage > 1) params.set("page", String(nextPage))
    return `/reports?${params.toString()}`
  }
  const isBulkStarterActive = typeFilter === BULK_STARTER_TYPE
  const isBulkSchedulerActive = typeFilter === BULK_SCHEDULER_TYPE
  const groupedHistory = Array.from(
    reportHistory.reduce((acc, item) => {
      const key = `${item.type}::${item.projectId || item.projectName}`
      const existing = acc.get(key)
      if (existing) {
        existing.count += 1
        if (item.createdAt > existing.lastCreatedAt) {
          existing.lastCreatedAt = item.createdAt
        }
        return acc
      }
      acc.set(key, {
        type: item.type,
        projectId: item.projectId,
        projectName: item.projectName,
        count: 1,
        lastCreatedAt: item.createdAt
      })
      return acc
    }, new Map<string, { type: string; projectId: string | null; projectName: string; count: number; lastCreatedAt: string }>())
  ).sort((a, b) => {
    if (b[1].count !== a[1].count) {
      return b[1].count - a[1].count
    }
    return b[1].lastCreatedAt.localeCompare(a[1].lastCreatedAt)
  })
  const groupedHistoryRows = groupedHistory.map((entry) => entry[1])
  const uniqueProjectsCount = new Set(reportHistory.map((item) => item.projectName)).size
  const bulkHistoryCount = reportHistory.filter(
    (item) => item.type === BULK_STARTER_TYPE || item.type === BULK_SCHEDULER_TYPE
  ).length
  const topGroupedEntry = groupedHistoryRows[0] || null
  const dailySnapshotRows = Array.from(
    reportHistory.reduce((acc, item) => {
      const dateKey = item.createdAt.slice(0, 10)
      acc.set(dateKey, (acc.get(dateKey) || 0) + 1)
      return acc
    }, new Map<string, number>())
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
  const dailySnapshotMax = dailySnapshotRows.reduce((max, entry) => Math.max(max, entry[1]), 0)

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Reports Hub</h1>
          <p className="mt-2 text-gray-600">
            Save operational markdown reports across workspace, agents, templates, files, teams, and projects.
          </p>
        </div>

        {hasProjects ? (
          <>
            <form className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Search history..."
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <select
                  name="type"
                  defaultValue={typeFilter}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Types</option>
                  {REPORT_METADATA_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {reportMetadataTypeLabel(type)}
                    </option>
                  ))}
                </select>
                <select
                  name="projectId"
                  defaultValue={projectFilter}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  name="limit"
                  defaultValue={String(historyLimit)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="20">20 / page</option>
                  <option value="50">50 / page</option>
                  <option value="100">100 / page</option>
                </select>
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Apply Filters
                </button>
              </div>
            </form>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Link
                href={buildReportsHref({ nextType: "", nextPage: 1 })}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  !typeFilter
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                All Reports
              </Link>
              <Link
                href={buildReportsHref({ nextType: BULK_STARTER_TYPE, nextPage: 1 })}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  isBulkStarterActive
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Bulk Starter Pack History
              </Link>
              <Link
                href={buildReportsHref({ nextType: BULK_SCHEDULER_TYPE, nextPage: 1 })}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  isBulkSchedulerActive
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Bulk Scheduler History
              </Link>
            </div>

            <OperationsHealthBanner projectId={projectFilter || undefined} />
            <OperationsStatusPanel projectId={projectFilter || undefined} />

            <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Displayed Records</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">{reportHistory.length}</div>
                <p className="mt-1 text-xs text-gray-600">Current page snapshot under active filters.</p>
              </div>
              <div className="rounded border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Projects Covered</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">{uniqueProjectsCount}</div>
                <p className="mt-1 text-xs text-gray-600">Distinct projects in this history page.</p>
              </div>
              <div className="rounded border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Bulk Runner Records</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">{bulkHistoryCount}</div>
                <p className="mt-1 text-xs text-gray-600">Starter-pack plus scheduler archived outputs.</p>
              </div>
              <div className="rounded border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Top Group</div>
                {topGroupedEntry ? (
                  <>
                    <div className="mt-2 text-sm font-semibold text-gray-900">
                      {reportMetadataTypeLabel(topGroupedEntry.type)}
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{topGroupedEntry.projectName}</p>
                    <p className="mt-1 text-xs text-gray-500">{topGroupedEntry.count} record(s)</p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">No history on this page.</p>
                )}
              </div>
            </div>

            <div className="mb-6 rounded border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Grouped History Snapshot</h2>
                <span className="text-xs text-gray-500">{groupedHistoryRows.length} group(s)</span>
              </div>
              {groupedHistoryRows.length === 0 ? (
                <p className="text-sm text-gray-500">No grouped history to display for current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-gray-500">
                        <th className="px-2 py-2 font-medium">Report Type</th>
                        <th className="px-2 py-2 font-medium">Project</th>
                        <th className="px-2 py-2 font-medium">Count</th>
                        <th className="px-2 py-2 font-medium">Latest</th>
                        <th className="px-2 py-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedHistoryRows.slice(0, 12).map((row) => (
                        <tr
                          key={`${row.type}-${row.projectName}`}
                          className="border-b border-gray-100 text-gray-700 last:border-b-0"
                        >
                          <td className="px-2 py-2">{reportMetadataTypeLabel(row.type)}</td>
                          <td className="px-2 py-2">{row.projectName}</td>
                          <td className="px-2 py-2">{row.count}</td>
                          <td className="px-2 py-2">{new Date(row.lastCreatedAt).toLocaleString()}</td>
                          <td className="px-2 py-2">
                            <Link
                              href={buildReportsHref({
                                nextPage: 1,
                                nextType: row.type,
                                nextProjectId: row.projectId || ""
                              })}
                              className="text-blue-600 hover:text-blue-700"
                            >
                              View records
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mb-6 rounded border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Daily Activity Snapshot</h2>
                <span className="text-xs text-gray-500">Last 7 dates on this page</span>
              </div>
              {dailySnapshotRows.length === 0 ? (
                <p className="text-sm text-gray-500">No daily activity to render.</p>
              ) : (
                <div className="space-y-2">
                  {dailySnapshotRows.map(([dateKey, count]) => {
                    const widthPercent =
                      dailySnapshotMax > 0 ? Math.max(Math.round((count / dailySnapshotMax) * 100), 6) : 0
                    return (
                      <div key={dateKey} className="grid grid-cols-[100px_1fr_44px] items-center gap-2 text-xs">
                        <div className="font-medium text-gray-600">{dateKey}</div>
                        <div className="h-2 rounded bg-gray-100">
                          <div
                            className="h-2 rounded bg-blue-500"
                            style={{ width: `${widthPercent}%` }}
                            aria-label={`${dateKey} count bar`}
                          />
                        </div>
                        <div className="text-right text-gray-700">{count}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Workspace</div>
            <p className="mt-1 text-xs text-gray-600">Save global workspace report into a project.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportWorkspaceReportButton />
              <SaveWorkspaceReportButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Agents</div>
            <p className="mt-1 text-xs text-gray-600">Save agent workload report with configurable hours window.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportAgentWorkloadButton />
              <SaveAgentWorkloadButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Agent Queue Status</div>
            <p className="mt-1 text-xs text-gray-600">Save queue backlog and online capacity report.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportAgentQueueStatusButton />
              <SaveAgentQueueStatusButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Templates</div>
            <p className="mt-1 text-xs text-gray-600">Save template catalog with usage metrics.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTemplatesCatalogHubButton />
              <SaveTemplatesCatalogButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Template Starter Packs</div>
            <p className="mt-1 text-xs text-gray-600">Save PM/IT/Ops starter packs composition catalog.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportStarterPacksHubButton />
              <SaveStarterPacksButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Files</div>
            <p className="mt-1 text-xs text-gray-600">Save files inventory report with linked task counts.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportFilesInventoryHubButton />
              <SaveFilesInventoryButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Teams</div>
            <p className="mt-1 text-xs text-gray-600">Save teams overview report.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTeamsOverviewHubButton />
              <SaveTeamsOverviewButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Projects</div>
            <p className="mt-1 text-xs text-gray-600">Save projects portfolio report.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportProjectsPortfolioHubButton />
              <SaveProjectsPortfolioButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Tasks</div>
            <p className="mt-1 text-xs text-gray-600">Save tasks report with scope and status filters.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTasksReportButton />
              <SaveTasksReportButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">History</div>
            <p className="mt-1 text-xs text-gray-600">Save current history filter result as markdown.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportReportsHistoryButton
                defaultType={typeFilter}
                defaultProjectId={projectFilter}
                defaultQuery={q}
                defaultPage={page}
                defaultLimit={historyLimit}
              />
              <SaveReportsHistoryButton
                defaultType={typeFilter}
                defaultProjectId={projectFilter}
                defaultQuery={q}
                defaultPage={page}
                defaultLimit={historyLimit}
              />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Bulk Runner History</div>
            <p className="mt-1 text-xs text-gray-600">
              Track archived bulk starter-pack and scheduler runner outputs across projects.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={buildReportsHref({ nextType: BULK_STARTER_TYPE, nextPage: 1 })}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              >
                Starter Pack History
              </Link>
              <Link
                href={buildReportsHref({ nextType: BULK_SCHEDULER_TYPE, nextPage: 1 })}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              >
                Scheduler History
              </Link>
              <Link
                href="/projects"
                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
              >
                Open Runner Console
              </Link>
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Operations Status</div>
            <p className="mt-1 text-xs text-gray-600">Save scheduler, queue, agent-run, and reports pipeline health snapshot.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportOperationsStatusButton defaultSourceProjectId={projectFilter || undefined} />
              <SaveOperationsStatusButton
                defaultTargetProjectId={projectFilter || undefined}
                defaultSourceProjectId={projectFilter || undefined}
              />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Project Bottlenecks</div>
            <p className="mt-1 text-xs text-gray-600">Save queue bottlenecks and high-risk task analysis.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportProjectBottlenecksButton />
              <SaveProjectBottlenecksButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Project Workspace</div>
            <p className="mt-1 text-xs text-gray-600">Save project-level workspace snapshot report.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportProjectWorkspaceReportButton />
              <SaveProjectWorkspaceReportButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Team Rollout History</div>
            <p className="mt-1 text-xs text-gray-600">Save team starter-pack and template rollout history as markdown.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTeamStarterHistoryButton />
              <SaveTeamStarterHistoryButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Team Workspace</div>
            <p className="mt-1 text-xs text-gray-600">Save team workspace operational report.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTeamWorkspaceReportHubButton />
              <SaveTeamWorkspaceReportHubButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Project Rollout History</div>
            <p className="mt-1 text-xs text-gray-600">Save project starter-pack and template rollout history as markdown.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportProjectStarterHistoryButton />
              <SaveProjectStarterHistoryButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Project Rollout Summary</div>
            <p className="mt-1 text-xs text-gray-600">Save project 7d/30d rollout KPI summary as markdown.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportProjectStarterSummaryButton />
              <SaveProjectStarterSummaryButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">Team Rollout Summary</div>
            <p className="mt-1 text-xs text-gray-600">Save team 7d/30d rollout KPI summary as markdown.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportTeamStarterSummaryButton />
              <SaveTeamStarterSummaryButton />
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">File Linked Tasks</div>
            <p className="mt-1 text-xs text-gray-600">Save linked-task report for a selected file.</p>
            <div className="mt-3 flex items-center gap-2">
              <ExportFileLinkedTasksReportButton />
              <SaveFileLinkedTasksReportButton />
            </div>
          </div>
            </div>

            <div className="rounded border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Recent Generated Reports</h2>
                <span className="text-xs text-gray-500">{reportHistory.length} record(s)</span>
              </div>
              {(isBulkStarterActive || isBulkSchedulerActive) && (
                <div className="mb-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Showing bulk-run archives only.
                </div>
              )}
              {reportHistory.length === 0 ? (
                <div className="text-sm text-gray-500">
                  {q || typeFilter || projectFilter
                    ? "No reports match current filters."
                    : "No report save activity yet."}
                </div>
              ) : (
                <div className="space-y-2">
                  {reportHistory.map((item, index) => (
                    <div
                      key={`${item.createdAt}-${item.fileId || index}`}
                      className="rounded border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700"
                    >
                      <div>
                        {new Date(item.createdAt).toLocaleString()} · {reportMetadataTypeLabel(item.type)} · {item.projectName} · by {item.actorName}
                      </div>
                      {item.fileId && (
                        <Link href={`/editor/${item.fileId}`} className="text-blue-600 hover:text-blue-700">
                          Open {item.fileName}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                {page > 1 ? (
                  <Link
                    href={buildReportsHref({ nextPage: page - 1 })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Previous</span>
                )}
                {hasMoreHistory ? (
                  <Link
                    href={buildReportsHref({ nextPage: page + 1 })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Next</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
            <div className="mb-4 text-6xl">🧭</div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">No accessible projects yet</h2>
            <p className="mx-auto mb-6 max-w-xl text-gray-600">
              Reports are generated from workspace, task, file, team, and project activity within your projects.
              Join or create a project to start generating reports.
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
        )}
      </div>
    </DashboardLayout>
  )
}
