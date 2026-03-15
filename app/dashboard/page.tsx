import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { ExportWorkspaceSummaryButton } from "@/components/dashboard/export-workspace-summary-button"
import { SaveWorkspaceReportButton } from "@/components/dashboard/save-workspace-report-button"
import { ExportOperationsStatusButton } from "@/components/reports/export-operations-status-button"
import { SaveOperationsStatusButton } from "@/components/reports/save-operations-status-button"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import Link from "next/link"

type WorkflowStepStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE"

function workflowStepStyle(status: WorkflowStepStatus) {
  switch (status) {
    case "COMPLETE":
      return "bg-emerald-100 text-emerald-700"
    case "IN_PROGRESS":
      return "bg-amber-100 text-amber-700"
    default:
      return "bg-gray-100 text-gray-600"
  }
}

async function getDashboardData(userId: string) {
  const [teams, projects, files, totalFilesCount, totalTasksCount, pendingReviewCount, pendingReviews] = await Promise.all([
    db.team.findMany({
      where: {
        members: {
          some: { userId }
        }
      },
      include: {
        _count: {
          select: {
            projects: true,
            members: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    }),
    db.project.findMany({
      where: {
        members: {
          some: { userId }
        }
      },
      include: {
        team: true,
        _count: {
          select: {
            files: true,
            members: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 5
    }),
    db.file.findMany({
      where: {
        project: {
          members: {
            some: { userId }
          }
        }
      },
      include: {
        project: true,
        creator: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 5
    }),
    db.file.count({
      where: {
        project: {
          members: {
            some: { userId }
          }
        }
      }
    }),
    db.task.count({
      where: {
        project: {
          members: {
            some: { userId }
          }
        }
      }
    }),
    db.deliverable.count({
      where: {
        task: {
          project: {
            members: {
              some: { userId }
            }
          }
        },
        status: {
          in: ["SUBMITTED", "UNDER_REVIEW"]
        }
      }
    }),
    db.deliverable.findMany({
      where: {
        task: {
          project: {
            members: {
              some: { userId }
            }
          }
        },
        status: {
          in: ["SUBMITTED", "UNDER_REVIEW"]
        }
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            project: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: [
        { submittedAt: "desc" },
        { updatedAt: "desc" }
      ],
      take: 6
    })
  ])

  return { teams, projects, files, totalFilesCount, totalTasksCount, pendingReviewCount, pendingReviews }
}

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const data = await getDashboardData(session.user.id!)
  const workflowSteps: Array<{
    index: number
    title: string
    href: string
    metric: string
    status: WorkflowStepStatus
    ctaLabel: string
    ctaHref: string
  }> = [
    {
      index: 1,
      title: "Create Team",
      href: "/teams",
      metric: `${data.teams.length} team(s)`,
      status: data.teams.length > 0 ? "COMPLETE" : "NOT_STARTED",
      ctaLabel: data.teams.length > 0 ? "Open Teams" : "Create Team",
      ctaHref: "/teams"
    },
    {
      index: 2,
      title: "Create Project",
      href: "/projects",
      metric: `${data.projects.length} project(s)`,
      status: data.projects.length > 0 ? "COMPLETE" : data.teams.length > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      ctaLabel: data.projects.length > 0 ? "Open Projects" : "Create Project",
      ctaHref: data.teams.length > 0 ? "/projects" : "/teams"
    },
    {
      index: 3,
      title: "Prepare Markdown",
      href: "/files",
      metric: `${data.totalFilesCount} file(s)`,
      status:
        data.totalFilesCount > 0
          ? "COMPLETE"
          : data.projects.length > 0
            ? "IN_PROGRESS"
            : "NOT_STARTED",
      ctaLabel: data.totalFilesCount > 0 ? "Open Files" : "Create File",
      ctaHref: data.projects.length > 0 ? "/files" : "/projects"
    },
    {
      index: 4,
      title: "Run Task Loop",
      href: "/tasks",
      metric: `${data.totalTasksCount} task(s)`,
      status:
        data.totalTasksCount > 0
          ? "COMPLETE"
          : data.totalFilesCount > 0
            ? "IN_PROGRESS"
            : "NOT_STARTED",
      ctaLabel: data.totalTasksCount > 0 ? "Open Tasks" : "Create Task",
      ctaHref: data.totalFilesCount > 0 ? "/tasks" : "/files"
    },
    {
      index: 5,
      title: "Review Queue",
      href: "/tasks?status=REVIEW",
      metric: `${data.pendingReviewCount} pending review`,
      status:
        data.pendingReviewCount > 0
          ? "IN_PROGRESS"
          : data.totalTasksCount > 0
            ? "COMPLETE"
            : "NOT_STARTED",
      ctaLabel: data.pendingReviewCount > 0 ? "Open Review Queue" : "View Tasks",
      ctaHref: data.pendingReviewCount > 0 ? "/tasks?status=REVIEW" : "/tasks"
    }
  ]
  const completedSteps = workflowSteps.filter((step) => step.status === "COMPLETE").length

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Welcome back, {session.user.name || "User"}!
              </h1>
              <p className="mt-2 text-gray-600">
                Here's what's happening with your projects
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SaveWorkspaceReportButton />
              <ExportOperationsStatusButton />
              <SaveOperationsStatusButton />
              <ExportWorkspaceSummaryButton
                userName={session.user.name || "User"}
                stats={{
                  teams: data.teams.length,
                  projects: data.projects.length,
                  files: data.totalFilesCount
                }}
                recentTeams={data.teams.map((team) => ({
                  id: team.id,
                  name: team.name,
                  projectCount: team._count.projects,
                  memberCount: team._count.members
                }))}
                recentProjects={data.projects.map((project) => ({
                  id: project.id,
                  name: project.name,
                  teamName: project.team.name,
                  fileCount: project._count.files
                }))}
                recentFiles={data.files.map((file) => ({
                  id: file.id,
                  name: file.name,
                  projectName: file.project.name,
                  updatedAt: file.updatedAt.toISOString()
                }))}
              />
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Human-Agent Workflow</h2>
          <p className="mt-1 text-sm text-gray-600">
            Follow this path to complete the core delivery loop.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Progress: {completedSteps}/{workflowSteps.length} steps completed
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            {workflowSteps.map((step) => (
              <div
                key={step.index}
                className="rounded border border-gray-200 bg-gray-50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-gray-500">Step {step.index}</div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${workflowStepStyle(step.status)}`}>
                    {step.status === "COMPLETE"
                      ? "Complete"
                      : step.status === "IN_PROGRESS"
                        ? "In Progress"
                        : "Not Started"}
                  </span>
                </div>
                <Link
                  href={step.href}
                  aria-label={`Workflow step ${step.index}: ${step.title}`}
                  className="mt-1 block text-sm font-semibold text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  {step.title}
                </Link>
                <div className="mt-1 text-xs text-gray-600">{step.metric}</div>
                <div className="mt-3">
                  <Link
                    href={step.ctaHref}
                    aria-label={`Step ${step.index} action: ${step.ctaLabel}`}
                    className="inline-flex rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    {step.ctaLabel}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Link
            href="/teams"
            className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
          >
            <div className="text-2xl mb-2">👥</div>
            <h3 className="font-semibold text-gray-900">Create Team</h3>
            <p className="text-sm text-gray-500">Start collaborating</p>
          </Link>

          <Link
            href="/projects"
            className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
          >
            <div className="text-2xl mb-2">📁</div>
            <h3 className="font-semibold text-gray-900">New Project</h3>
            <p className="text-sm text-gray-500">Organize your work</p>
          </Link>

          <Link
            href="/templates"
            className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
          >
            <div className="text-2xl mb-2">📝</div>
            <h3 className="font-semibold text-gray-900">Templates</h3>
            <p className="text-sm text-gray-500">Quick start docs</p>
          </Link>

          <Link
            href="/files"
            className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
          >
            <div className="text-2xl mb-2">📄</div>
            <h3 className="font-semibold text-gray-900">Browse Files</h3>
            <p className="text-sm text-gray-500">View all documents</p>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500">Teams</h3>
            <p className="mt-2 text-3xl font-bold text-gray-900">{data.teams.length}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500">Projects</h3>
            <p className="mt-2 text-3xl font-bold text-gray-900">{data.projects.length}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500">Files</h3>
            <p className="mt-2 text-3xl font-bold text-gray-900">{data.totalFilesCount}</p>
          </div>
        </div>

        <OperationsHealthBanner />
        <OperationsStatusPanel />

        {data.pendingReviews.length > 0 && (
          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50/30">
            <div className="flex items-center justify-between border-b border-amber-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Review Queue</h2>
              <Link
                href="/tasks?status=REVIEW"
                className="text-sm font-medium text-amber-700 hover:text-amber-800"
              >
                Open Review Queue
              </Link>
            </div>
            <div className="divide-y divide-amber-100">
              {data.pendingReviews.map((item) => (
                <Link
                  key={item.id}
                  href={`/tasks/${item.taskId}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-amber-50/60"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">{item.task.title}</div>
                    <div className="mt-1 text-xs text-gray-600">
                      {item.task.project.name} · Deliverable: {item.name}
                    </div>
                  </div>
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {item.status === "UNDER_REVIEW" ? "UNDER REVIEW" : "SUBMITTED"}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Teams */}
        {data.teams.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Recent Teams</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {data.teams.map((team) => (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}`}
                  className="p-6 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">{team.name}</h3>
                    <p className="text-sm text-gray-500">
                      {team._count.projects} projects • {team._count.members} members
                    </p>
                  </div>
                  <span className="text-gray-400">→</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Projects */}
        {data.projects.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Recent Projects</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {data.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="p-6 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500">
                      {project.team.name} • {project._count.files} files
                    </p>
                  </div>
                  <span className="text-gray-400">→</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Files */}
        {data.files.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Recent Files</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {data.files.map((file) => (
                <Link
                  key={file.id}
                  href={`/editor/${file.id}`}
                  className="p-6 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">{file.name}</h3>
                    <p className="text-sm text-gray-500">
                      {file.project.name} • Updated {new Date(file.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-gray-400">→</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {data.teams.length === 0 && data.projects.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🚀</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Get Started</h3>
            <p className="text-gray-600 mb-6">Create your first team to start collaborating</p>
            <Link
              href="/teams"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              Create Team
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
