import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { FileDeleteButton } from "@/components/files/file-delete-button"
import { CreateTaskFromFileButton } from "@/components/files/create-task-from-file-button"
import { ExportFileTasksReportButton } from "@/components/files/export-file-tasks-report-button"
import { SaveFileTasksReportButton } from "@/components/files/save-file-tasks-report-button"
import { BulkCreateTasksButton } from "@/components/files/bulk-create-tasks-button"
import { ExportFilesInventoryButton } from "@/components/files/export-files-inventory-button"
import { SaveFilesInventoryButton } from "@/components/files/save-files-inventory-button"
import Link from "next/link"
import { ActionType, FileStatus, FileTypeEnum, TaskStatus } from "@prisma/client"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Helper function to format date with time
function formatDateTime(date: Date): string {
  const now = new Date()
  const fileDate = new Date(date)

  // If today, show time only
  if (fileDate.toDateString() === now.toDateString()) {
    return `Today ${fileDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
  }

  // If yesterday, show "Yesterday"
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (fileDate.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${fileDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
  }

  // Otherwise show full date and time
  return `${fileDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${fileDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
}

type FilesPageProps = {
  searchParams?: Promise<{
    q?: string
    projectId?: string
    fileType?: string
    status?: string
    sort?: string
    taskRisk?: string
    page?: string
    limit?: string
  }>
}

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const params = (await searchParams) || {}
  const query = typeof params.q === "string" ? params.q.trim() : ""
  const selectedProjectId = typeof params.projectId === "string" ? params.projectId : ""
  const selectedFileType = typeof params.fileType === "string" ? params.fileType : "ALL"
  const selectedStatus = typeof params.status === "string" ? params.status : "ALL"
  const sort = typeof params.sort === "string" ? params.sort : "updated_desc"
  const taskRisk = typeof params.taskRisk === "string" ? params.taskRisk : "ALL"
  const pageRaw = typeof params.page === "string" ? Number(params.page) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1
  const limitRaw = typeof params.limit === "string" ? Number(params.limit) : 20
  const fileLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 10), 100) : 20
  const fileTypeFilter =
    selectedFileType !== "ALL" && Object.values(FileTypeEnum).includes(selectedFileType as FileTypeEnum)
      ? (selectedFileType as FileTypeEnum)
      : null
  const statusFilter =
    selectedStatus !== "ALL" && Object.values(FileStatus).includes(selectedStatus as FileStatus)
      ? (selectedStatus as FileStatus)
      : null
  const orderBy =
    sort === "created_desc"
      ? ({ createdAt: "desc" } as const)
      : sort === "name_asc"
        ? ({ name: "asc" } as const)
        : ({ updatedAt: "desc" } as const)

  const projects = await db.project.findMany({
    where: {
      members: {
        some: { userId: session.user.id }
      }
    },
    select: {
      id: true,
      name: true
    },
    orderBy: { name: "asc" }
  })
  const hasProjects = projects.length > 0

  const files = await db.file.findMany({
    where: {
      ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
      ...(fileTypeFilter ? { fileType: fileTypeFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { content: { contains: query, mode: "insensitive" } }
            ]
          }
        : {}),
      project: {
        members: {
          some: { userId: session.user.id }
        }
      }
    },
    include: {
      project: true,
      creator: true,
      _count: {
        select: {
          versions: true,
          comments: true
        }
      }
    },
    orderBy
  })
  const sortedFiles = sort === "size_desc"
    ? [...files].sort((a, b) => b.content.length - a.content.length)
    : files

  const fileIds = sortedFiles.map((file) => file.id)
  const taskLinkLogs = fileIds.length
    ? await db.activityLog.findMany({
        where: {
          fileId: { in: fileIds },
          taskId: { not: null },
          action: ActionType.TASK_CREATED
        },
        orderBy: { createdAt: "desc" },
        select: {
          fileId: true,
          taskId: true,
          createdAt: true,
          task: {
            select: {
              id: true,
              title: true,
              status: true
            }
          }
        }
      })
    : []

  const taskLinkMap = new Map<
    string,
    {
      count: number
      taskIds: Set<string>
      latestTask: {
        id: string
        title: string
        status: string
      } | null
    }
  >()
  for (const log of taskLinkLogs) {
    if (!log.fileId || !log.taskId) continue
    const current = taskLinkMap.get(log.fileId) || { count: 0, taskIds: new Set<string>(), latestTask: null }
    if (!current.taskIds.has(log.taskId)) {
      current.taskIds.add(log.taskId)
      current.count += 1
    }
    if (!current.latestTask && log.task) {
      current.latestTask = {
        id: log.task.id,
        title: log.task.title,
        status: log.task.status
      }
    }
    taskLinkMap.set(log.fileId, current)
  }

  const linkedTaskIds = Array.from(
    new Set(
      Array.from(taskLinkMap.values()).flatMap((item) => Array.from(item.taskIds))
    )
  )
  const linkedTasks = linkedTaskIds.length
    ? await db.task.findMany({
        where: { id: { in: linkedTaskIds } },
        select: {
          id: true,
          status: true,
          dueDate: true
        }
      })
    : []
  const taskById = new Map(linkedTasks.map((task) => [task.id, task]))
  const fileTaskRiskMap = new Map<string, { open: number; dueSoon: number; overdue: number }>()
  const dueSoonBoundary = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  for (const [fileId, link] of taskLinkMap) {
    const summary = { open: 0, dueSoon: 0, overdue: 0 }
    for (const taskId of link.taskIds) {
      const task = taskById.get(taskId)
      if (!task) continue
      if (task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED) {
        summary.open += 1
        if (task.dueDate) {
          if (task.dueDate.getTime() < Date.now()) summary.overdue += 1
          if (task.dueDate <= dueSoonBoundary) summary.dueSoon += 1
        }
      }
    }
    fileTaskRiskMap.set(fileId, summary)
  }

  const fileTypeIcons: Record<string, string> = {
    PROBLEM_DEFINITION: "🎯",
    SOLUTION_DESIGN: "💡",
    EXECUTION_TRACKING: "📊",
    RETROSPECTIVE_SUMMARY: "📝",
    CUSTOM: "📄"
  }
  const riskFilteredFiles = sortedFiles.filter((file) => {
    const link = taskLinkMap.get(file.id)
    const risk = fileTaskRiskMap.get(file.id) || { open: 0, dueSoon: 0, overdue: 0 }
    if (taskRisk === "HAS_OVERDUE") return risk.overdue > 0
    if (taskRisk === "HAS_DUE_SOON") return risk.dueSoon > 0
    if (taskRisk === "HAS_OPEN_TASKS") return risk.open > 0
    if (taskRisk === "NO_LINKED_TASKS") return (link?.count || 0) === 0
    return true
  })
  const pagedRiskFilteredFiles = riskFilteredFiles.slice((page - 1) * fileLimit, page * fileLimit)
  const hasMoreFiles = page * fileLimit < riskFilteredFiles.length
  const buildFilesHref = ({
    nextPage = page,
    nextLimit = fileLimit
  }: {
    nextPage?: number
    nextLimit?: number
  }) => {
    const nextParams = new URLSearchParams()
    if (query) nextParams.set("q", query)
    if (selectedProjectId) nextParams.set("projectId", selectedProjectId)
    if (selectedFileType !== "ALL") nextParams.set("fileType", selectedFileType)
    if (selectedStatus !== "ALL") nextParams.set("status", selectedStatus)
    if (sort !== "updated_desc") nextParams.set("sort", sort)
    if (taskRisk !== "ALL") nextParams.set("taskRisk", taskRisk)
    if (nextLimit !== 20) nextParams.set("limit", String(nextLimit))
    if (nextPage > 1) nextParams.set("page", String(nextPage))
    return `/files?${nextParams.toString()}`
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Files</h1>
            <p className="mt-2 text-gray-600">Browse and manage all your documents</p>
          </div>
          <div className="flex items-center gap-3">
            {hasProjects ? (
              <>
                <BulkCreateTasksButton fileIds={files.map((file) => file.id)} />
                <ExportFilesInventoryButton sourceProjectId={selectedProjectId || undefined} />
                <SaveFilesInventoryButton
                  defaultTargetProjectId={selectedProjectId || undefined}
                  sourceProjectId={selectedProjectId || undefined}
                />
                <Link
                  href="/files/import"
                  className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Import File
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/teams"
                  className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Create Team
                </Link>
                <Link
                  href="/projects"
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Create Project
                </Link>
              </>
            )}
          </div>
        </div>

        {hasProjects ? (
          <>
            <form className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-8">
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Search files..."
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <select
                  name="projectId"
                  defaultValue={selectedProjectId}
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
                  name="fileType"
                  defaultValue={fileTypeFilter || "ALL"}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Types</option>
                  {Object.values(FileTypeEnum).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  name="status"
                  defaultValue={statusFilter || "ALL"}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Status</option>
                  {Object.values(FileStatus).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="updated_desc">Recently Updated</option>
                  <option value="created_desc">Newest Created</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="size_desc">Largest First</option>
                </select>
                <select
                  name="taskRisk"
                  defaultValue={taskRisk}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="ALL">All Task Risk</option>
                  <option value="HAS_OVERDUE">Has Overdue Tasks</option>
                  <option value="HAS_DUE_SOON">Has Due ≤ 3d Tasks</option>
                  <option value="HAS_OPEN_TASKS">Has Open Tasks</option>
                  <option value="NO_LINKED_TASKS">No Linked Tasks</option>
                </select>
                <select
                  name="limit"
                  defaultValue={String(fileLimit)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="10">10 / page</option>
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

            <OperationsHealthBanner projectId={selectedProjectId || undefined} />
            <OperationsStatusPanel projectId={selectedProjectId || undefined} />

            {/* Files List */}
            {pagedRiskFilteredFiles.length > 0 ? (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Creator
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Versions
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Comments
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Linked Tasks
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Updated
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pagedRiskFilteredFiles.map((file) => (
                    <tr key={file.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className="text-2xl mr-3">{fileTypeIcons[file.fileType]}</span>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{file.name}</div>
                            <div className="text-xs text-gray-500">{file.fileType.replace('_', ' ')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {file.project.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {file.creator.name || file.creator.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatFileSize(file.content.length)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {file._count.versions + 1} version{file._count.versions + 1 !== 1 ? 's' : ''}
                        </span>
                        <div className="text-xs text-gray-400 mt-1">
                          Current + {file._count.versions} snapshot{file._count.versions !== 1 ? 's' : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          file._count.comments > 0
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {file._count.comments} comment{file._count.comments !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {(() => {
                          const linked = taskLinkMap.get(file.id)
                          if (!linked || linked.count === 0) {
                            return <span className="text-gray-400">No linked tasks</span>
                          }
                          return (
                            <div>
                              <div className="font-medium text-gray-900">
                                {linked.count} task{linked.count > 1 ? "s" : ""}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                  Open {fileTaskRiskMap.get(file.id)?.open || 0}
                                </span>
                                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                  Due ≤3d {fileTaskRiskMap.get(file.id)?.dueSoon || 0}
                                </span>
                                <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                  Overdue {fileTaskRiskMap.get(file.id)?.overdue || 0}
                                </span>
                              </div>
                              {linked.latestTask && (
                                <Link
                                  href={`/tasks/${linked.latestTask.id}`}
                                  className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                  Latest: {linked.latestTask.title}
                                </Link>
                              )}
                              <div>
                                <Link href={`/tasks?sourceFileId=${file.id}`} className="text-xs text-blue-600 hover:text-blue-800">
                                  View all linked tasks
                                </Link>
                              </div>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDateTime(file.updatedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-3">
                          <Link
                            href={`/editor/${file.id}`}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Open →
                          </Link>
                          <span className="text-gray-300">|</span>
                          <CreateTaskFromFileButton
                            fileId={file.id}
                            fileName={file.name}
                          />
                          <span className="text-gray-300">|</span>
                          <ExportFileTasksReportButton
                            fileId={file.id}
                            fileName={file.name}
                          />
                          <span className="text-gray-300">|</span>
                          <SaveFileTasksReportButton
                            fileId={file.id}
                          />
                          <span className="text-gray-300">|</span>
                          <FileDeleteButton
                            fileId={file.id}
                            fileName={file.name}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {page > 1 ? (
                <Link
                  href={buildFilesHref({ nextPage: page - 1 })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-400">Previous</span>
              )}
              {hasMoreFiles ? (
                <Link
                  href={buildFilesHref({ nextPage: page + 1 })}
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
              /* Empty State */
              <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
                <div className="text-6xl mb-4">📄</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {page > 1
                    ? "No files on this page"
                    : query || selectedProjectId || fileTypeFilter || statusFilter || taskRisk !== "ALL"
                    ? "No files match your filters"
                    : "No files yet"}
                </h3>
                <p className="text-gray-600 mb-6">
                  {page > 1
                    ? "Try going to the previous page or lowering page size."
                    : query || selectedProjectId || fileTypeFilter || statusFilter || taskRisk !== "ALL"
                    ? "Try clearing filters or import markdown files into your project."
                    : "Create a file from a template or import markdown to get started."}
                </p>
                <div className="flex items-center justify-center gap-3">
                  {page > 1 ? (
                    <Link
                      href={buildFilesHref({ nextPage: Math.max(page - 1, 1) })}
                      className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                    >
                      Previous Page
                    </Link>
                  ) : (
                    <>
                      <Link
                        href="/files/import"
                        className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
                      >
                        Import File
                      </Link>
                      <Link
                        href="/templates"
                        className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Browse Templates
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
            <div className="mb-4 text-6xl">🧭</div>
            <h3 className="mb-2 text-xl font-semibold text-gray-900">No accessible projects yet</h3>
            <p className="mx-auto mb-6 max-w-xl text-gray-600">
              Files are organized by project. Create a team and project first, then import or generate markdown files.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/teams"
                className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                Go to Teams
              </Link>
              <Link
                href="/projects"
                className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
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
