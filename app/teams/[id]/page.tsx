import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { TeamDetailView } from "@/components/team/team-detail-view"
import { deriveRecommendedTemplateCategoriesFromCounts } from "@/lib/templates/recommendation"
import { TaskStatus } from "@prisma/client"

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const team = await db.team.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            }
          }
        }
      },
      projects: {
        include: {
          creator: {
            select: {
              name: true,
            }
          }
        }
      }
    }
  })

  if (!team) {
    redirect("/teams")
  }

  // Check if user is a member
  const isMember = team.members.some(m => m.userId === session.user.id)
  if (!isMember) {
    redirect("/teams")
  }

  // Get current user's role
  const currentUserRole = team.members.find(m => m.userId === session.user.id)?.role || 'MEMBER'
  const teamProjectIds = team.projects.map((project) => project.id)
  const templateUsageRows = teamProjectIds.length
    ? await db.file.groupBy({
        by: ["templateType"],
        where: {
          projectId: { in: teamProjectIds }
        },
        _count: { _all: true }
      })
    : []
  const recommendedCategories = deriveRecommendedTemplateCategoriesFromCounts({
    items: templateUsageRows.map((row) => ({
      templateType: row.templateType,
      count: row._count._all
    })),
    limit: 3
  })
  const recommendedTemplates = recommendedCategories.length
    ? await db.template.findMany({
        where: {
          category: { in: recommendedCategories },
          OR: [{ isPublic: true }, { creatorId: session.user.id }]
        },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }],
        take: 6
      })
    : []
  const now = new Date()
  const dueSoonBoundary = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const [fileCount, openTaskCount, dueSoonTaskCount, overdueTaskCount] = teamProjectIds.length
    ? await Promise.all([
        db.file.count({
          where: { projectId: { in: teamProjectIds } }
        }),
        db.task.count({
          where: {
            projectId: { in: teamProjectIds },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] }
          }
        }),
        db.task.count({
          where: {
            projectId: { in: teamProjectIds },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
            dueDate: { lte: dueSoonBoundary }
          }
        }),
        db.task.count({
          where: {
            projectId: { in: teamProjectIds },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
            dueDate: { lt: now }
          }
        })
      ])
    : [0, 0, 0, 0]

  return (
    <DashboardLayout>
      <TeamDetailView
        team={{
          ...team,
          currentUserRole,
          recommendedTemplates,
          overview: {
            projectCount: team.projects.length,
            fileCount,
            openTaskCount,
            dueSoonTaskCount,
            overdueTaskCount
          }
        }}
      />
    </DashboardLayout>
  )
}
