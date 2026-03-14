import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import Link from "next/link"
import { CreateTeamDialog } from "@/components/team/create-team-dialog"
import { ExportTeamsOverviewButton } from "@/components/team/export-teams-overview-button"
import { SaveTeamsOverviewButton } from "@/components/team/save-teams-overview-button"
import { ExportTeamWorkspaceReportHubButton } from "@/components/reports/export-team-workspace-report-hub-button"
import { SaveTeamWorkspaceReportHubButton } from "@/components/reports/save-team-workspace-report-hub-button"
import { ExportTeamStarterHistoryButton } from "@/components/reports/export-team-starter-history-button"
import { SaveTeamStarterHistoryButton } from "@/components/reports/save-team-starter-history-button"
import { ExportTeamStarterSummaryButton } from "@/components/reports/export-team-starter-summary-button"
import { SaveTeamStarterSummaryButton } from "@/components/reports/save-team-starter-summary-button"
import { StarterPackTeamApplyButton } from "@/components/templates/starter-pack-team-apply-button"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { ActionType } from "@prisma/client"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"

type TeamsPageProps = {
  searchParams?: Promise<{
    q?: string
    projectId?: string
    teamId?: string
    sort?: string
    page?: string
    limit?: string
  }>
}

export default async function TeamsPage({ searchParams }: TeamsPageProps) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const params = (await searchParams) || {}
  const query = typeof params.q === "string" ? params.q.trim() : ""
  const selectedProjectId = typeof params.projectId === "string" ? params.projectId : ""
  const selectedTeamId = typeof params.teamId === "string" ? params.teamId : ""
  const sort = typeof params.sort === "string" ? params.sort : "created_desc"
  const pageRaw = typeof params.page === "string" ? Number(params.page) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1
  const limitRaw = typeof params.limit === "string" ? Number(params.limit) : 18
  const teamLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 9), 60) : 18
  const hasFilters = Boolean(query || selectedTeamId || sort !== "created_desc")

  const totalTeamsCount = await db.team.count({
    where: {
      members: {
        some: { userId: session.user.id }
      }
    }
  })
  const hasAnyTeams = totalTeamsCount > 0

  const teams = await db.team.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } }
            ]
          }
        : {}),
      members: {
        some: { userId: session.user.id }
      }
    },
    include: {
      projects: {
        select: {
          id: true,
          name: true
        },
        orderBy: {
          name: "asc"
        }
      },
      members: {
        include: { user: true }
      },
      _count: {
        select: {
          projects: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  })
  const sortedTeams = [...teams].sort((a, b) => {
    if (sort === "name_asc") return a.name.localeCompare(b.name)
    if (sort === "members_desc") return b.members.length - a.members.length
    if (sort === "projects_desc") return b._count.projects - a._count.projects
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
  const visibleTeams = selectedTeamId ? sortedTeams.filter((team) => team.id === selectedTeamId) : sortedTeams
  const pagedVisibleTeams = visibleTeams.slice((page - 1) * teamLimit, page * teamLimit)
  const hasMoreTeams = page * teamLimit < visibleTeams.length
  const builtInTemplates = await db.template.findMany({
    where: {
      isBuiltIn: true,
      OR: [{ isPublic: true }, { creatorId: session.user.id }]
    },
    select: {
      id: true,
      name: true,
      category: true
    }
  })
  const starterPacks = deriveStarterTemplatePacks(
    builtInTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category
    }))
  )
  const adminTeams = visibleTeams.filter((team) =>
    team.members.some((member) => member.userId === session.user.id && member.role === "ADMIN")
  )
  const adminTeamProjectIds = Array.from(
    new Set(adminTeams.flatMap((team) => team.projects.map((project) => project.id)))
  )
  const editableMemberships =
    adminTeamProjectIds.length > 0
      ? await db.projectMember.findMany({
          where: {
            userId: session.user.id,
            projectId: { in: adminTeamProjectIds },
            role: { in: ["ADMIN", "EDITOR"] }
          },
          select: {
            projectId: true
          }
        })
      : []
  const editableProjectIdSet = new Set(editableMemberships.map((item) => item.projectId))
  const teamQuickApplyTargets = adminTeams
    .map((team) => ({
      id: team.id,
      name: team.name,
      projects: team.projects
        .filter((project) => editableProjectIdSet.has(project.id))
        .map((project) => ({ id: project.id, name: project.name }))
    }))
    .filter((team) => team.projects.length > 0)
  const projectIdToTeamId = new Map<string, string>()
  for (const team of visibleTeams) {
    for (const project of team.projects) {
      projectIdToTeamId.set(project.id, team.id)
    }
  }
  const starterRuns7dMap = new Map<string, number>()
  const allProjectIds = Array.from(projectIdToTeamId.keys())
  const starterActivityLogs =
    allProjectIds.length > 0
      ? await db.activityLog.findMany({
          where: {
            action: ActionType.TASK_UPDATED,
            projectId: { in: allProjectIds },
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          },
          select: {
            projectId: true,
            metadata: true
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 3000
        })
      : []
  for (const log of starterActivityLogs) {
    const metadata =
      log.metadata && typeof log.metadata === "object" ? (log.metadata as Record<string, unknown>) : null
    const type = typeof metadata?.type === "string" ? metadata.type : null
    if (
      type !== "TEAM_STARTER_PACK_APPLIED" &&
      type !== "TEAM_TEMPLATE_ROLLOUT" &&
      type !== "PROJECT_STARTER_PACK_APPLIED" &&
      type !== "PROJECT_TEMPLATE_ROLLOUT"
    ) {
      continue
    }
    if (!log.projectId) continue
    const teamId = projectIdToTeamId.get(log.projectId)
    if (!teamId) continue
    starterRuns7dMap.set(teamId, (starterRuns7dMap.get(teamId) || 0) + 1)
  }
  const teamOverviewItems = visibleTeams.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    memberCount: team.members.length,
    projectCount: team._count.projects,
    starterRuns7d: starterRuns7dMap.get(team.id) || 0,
    createdAt: team.createdAt.toISOString()
  }))
  const defaultTeamId = selectedTeamId || visibleTeams[0]?.id || ""
  const defaultTeamTargetProjectId =
    selectedProjectId || visibleTeams.find((team) => team.id === defaultTeamId)?.projects[0]?.id || ""
  const buildTeamsHref = ({
    nextPage = page,
    nextLimit = teamLimit
  }: {
    nextPage?: number
    nextLimit?: number
  }) => {
    const nextParams = new URLSearchParams()
    if (query) nextParams.set("q", query)
    if (selectedProjectId) nextParams.set("projectId", selectedProjectId)
    if (selectedTeamId) nextParams.set("teamId", selectedTeamId)
    if (sort !== "created_desc") nextParams.set("sort", sort)
    if (nextLimit !== 18) nextParams.set("limit", String(nextLimit))
    if (nextPage > 1) nextParams.set("page", String(nextPage))
    return `/teams?${nextParams.toString()}`
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teams</h1>
            <p className="mt-2 text-gray-600">Manage your teams and collaborate with others</p>
          </div>
          <div className="flex items-center gap-3">
            {hasAnyTeams ? (
              <>
                <ExportTeamsOverviewButton teams={teamOverviewItems} />
                <SaveTeamsOverviewButton />
                <ExportTeamWorkspaceReportHubButton defaultTeamId={defaultTeamId} />
                <SaveTeamWorkspaceReportHubButton
                  defaultTeamId={defaultTeamId}
                  defaultTargetProjectId={defaultTeamTargetProjectId}
                />
                <ExportTeamStarterHistoryButton defaultTeamId={defaultTeamId} />
                <SaveTeamStarterHistoryButton
                  defaultTeamId={defaultTeamId}
                  defaultTargetProjectId={defaultTeamTargetProjectId}
                />
                <ExportTeamStarterSummaryButton defaultTeamId={defaultTeamId} />
                <SaveTeamStarterSummaryButton
                  defaultTeamId={defaultTeamId}
                  defaultTargetProjectId={defaultTeamTargetProjectId}
                />
              </>
            ) : (
              <Link
                href="/templates"
                className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
              >
                Browse Templates
              </Link>
            )}
            <CreateTeamDialog />
          </div>
        </div>

        <form className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search teams..."
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <select
              name="teamId"
              defaultValue={selectedTeamId}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Teams</option>
              {sortedTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <select
              name="sort"
              defaultValue={sort}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="created_desc">Newest</option>
              <option value="name_asc">Name A-Z</option>
              <option value="members_desc">Most Members</option>
              <option value="projects_desc">Most Projects</option>
            </select>
            <select
              name="limit"
              defaultValue={String(teamLimit)}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="9">9 / page</option>
              <option value="18">18 / page</option>
              <option value="36">36 / page</option>
              <option value="60">60 / page</option>
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

        {hasAnyTeams && starterPacks.length > 0 && teamQuickApplyTargets.length > 0 && (
          <div className="mb-6 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-indigo-900">Starter Packs</h2>
              <p className="text-xs text-indigo-800">
                Apply built-in PM/IT/Ops starter packs directly to projects within your admin teams.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {starterPacks.map((pack) => (
                <StarterPackTeamApplyButton
                  key={pack.id}
                  packId={pack.id}
                  packName={pack.name}
                  teams={teamQuickApplyTargets}
                />
              ))}
            </div>
          </div>
        )}

        {/* Teams Grid */}
        {pagedVisibleTeams.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pagedVisibleTeams.map((team) => (
              <Link
                key={team.id}
                href={`/teams/${team.id}`}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900">{team.name}</h3>
                    {team.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{team.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4 text-gray-500">
                    <span>👤 {team._count.projects} projects</span>
                    <span>👥 {team.members.length} members</span>
                  </div>
                  <span className="text-blue-600">→</span>
                </div>
                <div className="mt-2 text-xs text-indigo-700">
                  Starter rollouts (7d): {starterRuns7dMap.get(team.id) || 0}
                </div>

                {/* Members avatars */}
                <div className="mt-4 flex items-center">
                  <div className="flex -space-x-2">
                    {team.members.slice(0, 4).map((member) => (
                      <div
                        key={member.id}
                        className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium border-2 border-white"
                        title={member.user.name || member.user.email}
                      >
                        {(member.user.name || member.user.email || "U").charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {team.members.length > 4 && (
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs font-medium border-2 border-white">
                        +{team.members.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {page > 1 ? (
                <Link
                  href={buildTeamsHref({ nextPage: page - 1 })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Previous</span>
              )}
              {hasMoreTeams ? (
                <Link
                  href={buildTeamsHref({ nextPage: page + 1 })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Next</span>
              )}
            </div>
          </>
        ) : hasAnyTeams ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <div className="text-6xl mb-4">🔎</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {page > 1 ? "No teams on this page" : "No teams match your filters"}
            </h3>
            <p className="text-gray-600 mb-6">
              {page > 1
                ? "Try going to the previous page or lowering page size."
                : hasFilters
                ? "Try adjusting search keywords or team filters."
                : "Try refreshing this page."}
            </p>
            {page > 1 ? (
              <Link
                href={buildTeamsHref({ nextPage: Math.max(page - 1, 1) })}
                className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                Previous Page
              </Link>
            ) : (
              <Link
                href="/teams"
                className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                Clear Filters
              </Link>
            )}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <div className="text-6xl mb-4">🧭</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No teams yet</h3>
            <p className="text-gray-600 mb-6">Create your first team to start collaborating.</p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/templates"
                className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
              >
                Browse Templates
              </Link>
              <CreateTeamDialog />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
