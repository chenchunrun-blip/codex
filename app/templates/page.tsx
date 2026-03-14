import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { TemplateCard } from "@/components/templates/template-card"
import { ExportTemplatesCatalogButton } from "@/components/templates/export-templates-catalog-button"
import { SaveTemplatesCatalogButton } from "@/components/templates/save-templates-catalog-button"
import { SaveStarterPacksButton } from "@/components/templates/save-starter-packs-button"
import { ExportStarterPacksHubButton } from "@/components/templates/export-starter-packs-hub-button"
import { StarterPackQuickApplyButton } from "@/components/templates/starter-pack-quick-apply-button"
import { StarterPackTeamApplyButton } from "@/components/templates/starter-pack-team-apply-button"
import Link from "next/link"
import { ActionType, ProjectRole, TeamRole, TemplateCategory } from "@prisma/client"
import { deriveStarterTemplatePacks } from "@/lib/templates/starter-packs"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"

type TemplatesPageProps = {
  searchParams?: Promise<{
    q?: string
    category?: string
    visibility?: string
    sort?: string
    page?: string
    limit?: string
  }>
}

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const params = (await searchParams) || {}
  const query = typeof params.q === "string" ? params.q.trim() : ""
  const category = typeof params.category === "string" ? params.category : "ALL"
  const visibility = typeof params.visibility === "string" ? params.visibility : "ALL"
  const sort = typeof params.sort === "string" ? params.sort : "BUILTIN_CREATED_DESC"
  const pageRaw = typeof params.page === "string" ? Number(params.page) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1
  const limitRaw = typeof params.limit === "string" ? Number(params.limit) : 24
  const templateLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 12), 60) : 24
  const templateOffset = (page - 1) * templateLimit

  const categoryFilter =
    category !== "ALL" && Object.values(TemplateCategory).includes(category as TemplateCategory)
      ? (category as TemplateCategory)
      : null

  const visibilityWhere =
    visibility === "MINE"
      ? { creatorId: session.user.id }
      : visibility === "PUBLIC"
        ? { isPublic: true }
        : visibility === "BUILT_IN"
          ? { isBuiltIn: true }
          : {
              OR: [{ isPublic: true }, { creatorId: session.user.id }]
            }

  const templates = await db.template.findMany({
    where: {
      AND: [
        visibilityWhere,
        ...(categoryFilter ? [{ category: categoryFilter }] : []),
        ...(query
          ? [
              {
                OR: [
                  { name: { contains: query, mode: "insensitive" as const } },
                  { description: { contains: query, mode: "insensitive" as const } },
                  { content: { contains: query, mode: "insensitive" as const } }
                ]
              }
            ]
          : [])
      ]
    },
    skip: templateOffset,
    take: templateLimit + 1,
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: [
      { isBuiltIn: 'desc' },
      { createdAt: 'desc' }
    ]
  })
  const hasMoreTemplates = templates.length > templateLimit
  const pagedTemplates = templates.slice(0, templateLimit)
  const templateIds = pagedTemplates.map((template) => template.id)
  const usageLogs = templateIds.length
    ? await db.activityLog.findMany({
        where: {
          action: ActionType.FILE_CREATED,
          project: {
            members: {
              some: { userId: session.user.id }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          createdAt: true,
          metadata: true
        }
      })
    : []
  const usageMap = new Map<string, { count: number; lastUsedAt: string | null }>()
  for (const log of usageLogs) {
    if (!log.metadata || typeof log.metadata !== "object") continue
    const metadata = log.metadata as Record<string, unknown>
    if (metadata.type !== "FILE_CREATED_FROM_TEMPLATE") continue
    const templateId = typeof metadata.templateId === "string" ? metadata.templateId : null
    if (!templateId || !templateIds.includes(templateId)) continue
    const existing = usageMap.get(templateId) || { count: 0, lastUsedAt: null }
    usageMap.set(templateId, {
      count: existing.count + 1,
      lastUsedAt: existing.lastUsedAt || log.createdAt.toISOString()
    })
  }
  const enrichedTemplates = pagedTemplates.map((template) => ({
    ...template,
    usageCount: usageMap.get(template.id)?.count || 0,
    lastUsedAt: usageMap.get(template.id)?.lastUsedAt || null,
    canManage: !template.isBuiltIn && template.creatorId === session.user.id
  }))
  const sortedTemplates = [...enrichedTemplates].sort((a, b) => {
    if (sort === "USAGE_DESC") return b.usageCount - a.usageCount
    if (sort === "UPDATED_DESC") return b.updatedAt.getTime() - a.updatedAt.getTime()
    if (sort === "NAME_ASC") return a.name.localeCompare(b.name)
    return Number(b.isBuiltIn) - Number(a.isBuiltIn) || b.createdAt.getTime() - a.createdAt.getTime()
  })
  const starterPacks = deriveStarterTemplatePacks(
    sortedTemplates
      .filter((template) => template.isBuiltIn)
      .map((template) => ({
        id: template.id,
        name: template.name,
        category: template.category
      }))
  )
  const templateNameById = new Map(sortedTemplates.map((template) => [template.id, template.name]))
  const templateCatalogItems = sortedTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    category: template.category,
    isBuiltIn: template.isBuiltIn,
    usageCount: template.usageCount || 0,
    updatedAt: template.updatedAt.toISOString()
  }))
  const editableProjects = await db.projectMember.findMany({
    where: {
      userId: session.user.id,
      role: { in: [ProjectRole.ADMIN, ProjectRole.EDITOR] }
    },
    select: {
      projectId: true,
      project: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      project: {
        name: "asc"
      }
    }
  })
  const quickApplyProjects = editableProjects.map((item) => ({
    id: item.project.id,
    name: item.project.name
  }))
  const editableProjectIdSet = new Set(quickApplyProjects.map((project) => project.id))
  const adminTeams = await db.teamMember.findMany({
    where: {
      userId: session.user.id,
      role: TeamRole.ADMIN
    },
    select: {
      team: {
        select: {
          id: true,
          name: true,
          projects: {
            select: {
              id: true,
              name: true
            },
            orderBy: {
              name: "asc"
            }
          }
        }
      }
    },
    orderBy: {
      team: {
        name: "asc"
      }
    }
  })
  const quickApplyTeams = adminTeams
    .map((item) => ({
      id: item.team.id,
      name: item.team.name,
      projects: item.team.projects.filter((project) => editableProjectIdSet.has(project.id))
    }))
    .filter((team) => team.projects.length > 0)
  const hasTemplateFilters =
    Boolean(query) || Boolean(categoryFilter) || visibility !== "ALL" || sort !== "BUILTIN_CREATED_DESC"
  const hasQuickApplyTargets = quickApplyProjects.length > 0 || quickApplyTeams.length > 0
  const buildTemplatesHref = ({
    nextPage = page,
    nextLimit = templateLimit
  }: {
    nextPage?: number
    nextLimit?: number
  }) => {
    const nextParams = new URLSearchParams()
    if (query) nextParams.set("q", query)
    if (category && category !== "ALL") nextParams.set("category", category)
    if (visibility !== "ALL") nextParams.set("visibility", visibility)
    if (sort !== "BUILTIN_CREATED_DESC") nextParams.set("sort", sort)
    if (nextLimit !== 24) nextParams.set("limit", String(nextLimit))
    if (nextPage > 1) nextParams.set("page", String(nextPage))
    return `/templates?${nextParams.toString()}`
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Template Center</h1>
            <p className="mt-2 text-gray-600">Start with built-in templates or create your own</p>
          </div>
          <div className="flex items-center gap-3">
            <ExportTemplatesCatalogButton templates={templateCatalogItems} />
            <SaveTemplatesCatalogButton />
            <ExportStarterPacksHubButton />
            <SaveStarterPacksButton />
            <Link
              href="/templates/new"
              className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create Template
            </Link>
          </div>
        </div>

        <form className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search templates..."
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <select
              name="category"
              defaultValue={categoryFilter || "ALL"}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              {Object.values(TemplateCategory).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              name="visibility"
              defaultValue={visibility}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="ALL">All Templates</option>
              <option value="PUBLIC">Public</option>
              <option value="MINE">Mine</option>
              <option value="BUILT_IN">Built-in</option>
            </select>
            <select
              name="sort"
              defaultValue={sort}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="BUILTIN_CREATED_DESC">Built-in First</option>
              <option value="USAGE_DESC">Most Used</option>
              <option value="UPDATED_DESC">Recently Updated</option>
              <option value="NAME_ASC">Name A-Z</option>
            </select>
            <select
              name="limit"
              defaultValue={String(templateLimit)}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="12">12 / page</option>
              <option value="24">24 / page</option>
              <option value="48">48 / page</option>
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

        <OperationsHealthBanner />
        <OperationsStatusPanel />

        {starterPacks.length > 0 && (
          <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-blue-900">Starter Packs</h2>
                <p className="text-xs text-blue-800">
                  Built-in template bundles for faster project bootstrapping
                </p>
              </div>
              <Link
                href="/projects"
                className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                Open Bulk Runner
              </Link>
            </div>
            {!hasQuickApplyTargets && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No editable projects yet. Create or join a project to enable quick apply for starter packs.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {starterPacks.map((pack) => (
                <div key={pack.id} className="rounded border border-blue-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{pack.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {pack.templateIds.length} templates
                      </span>
                      <StarterPackQuickApplyButton
                        packId={pack.id}
                        packName={pack.name}
                        projects={quickApplyProjects}
                      />
                      <StarterPackTeamApplyButton
                        packId={pack.id}
                        packName={pack.name}
                        teams={quickApplyTeams}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{pack.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pack.templateIds.map((templateId) => (
                      <span
                        key={templateId}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {templateNameById.get(templateId) || templateId}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Templates Grid */}
        {sortedTemplates.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {page > 1 ? (
                <Link
                  href={buildTemplatesHref({ nextPage: page - 1 })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Previous</span>
              )}
              {hasMoreTemplates ? (
                <Link
                  href={buildTemplatesHref({ nextPage: page + 1 })}
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
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {page > 1
                ? "No templates on this page"
                : hasTemplateFilters
                  ? "No templates match your filters"
                  : "No templates available"}
            </h3>
            <p className="text-gray-600">
              {page > 1
                ? "Try going to the previous page or lowering page size."
                : hasTemplateFilters
                  ? "Try changing search, category, visibility, or sorting options."
                  : "Built-in templates will appear here."}
            </p>
            {page > 1 ? (
              <Link
                href={buildTemplatesHref({ nextPage: Math.max(page - 1, 1) })}
                className="mt-6 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                Previous Page
              </Link>
            ) : hasTemplateFilters ? (
              <Link
                href="/templates"
                className="mt-6 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                Clear Filters
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
