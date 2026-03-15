import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { ProjectDetailView } from "@/components/project/project-detail-view"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const project = await db.project.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      },
      team: {
        select: {
          id: true,
          name: true,
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
      files: {
        orderBy: {
          createdAt: 'desc'
        },
        take: 10,
      }
    }
  })

  if (!project) {
    redirect("/projects")
  }

  // Check if user is a member
  const isMember = project.members.some(m => m.userId === session.user.id)
  if (!isMember) {
    redirect("/projects")
  }

  // Get current user's role
  const currentUserRole = project.members.find(m => m.userId === session.user.id)?.role || 'VIEWER'

  return (
    <DashboardLayout>
      <ProjectDetailView
        project={{
          ...project,
          currentUserRole
        }}
      />
    </DashboardLayout>
  )
}
