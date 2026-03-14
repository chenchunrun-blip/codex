import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { redirect } from "next/navigation"
import { ProjectRole, TeamRole } from "@prisma/client"
import { NextResponse } from "next/server"

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }
  return session
}

/**
 * For API routes - returns null instead of redirecting
 * Use this in API route handlers to check authentication
 */
export async function getAuthSession() {
  const session = await auth()
  return session
}

/**
 * For API routes - returns 401 response if not authenticated
 * Use this when you need to ensure authentication in API routes
 */
export async function requireAuthApi() {
  const session = await auth()
  if (!session?.user) {
    return null
  }
  return session
}

export async function requireTeamAccess(
  teamId: string,
  minRole: TeamRole = TeamRole.MEMBER
) {
  const session = await requireAuth()

  const membership = await db.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: session.user!.id
      }
    }
  })

  if (!membership) {
    throw new Error("Access denied: Not a team member")
  }

  const roleHierarchy = { MEMBER: 0, ADMIN: 1 }
  if (roleHierarchy[membership.role] < roleHierarchy[minRole]) {
    throw new Error("Access denied: Insufficient permissions")
  }

  return { session, membership }
}

export async function requireProjectAccess(
  projectId: string,
  minRole: ProjectRole = ProjectRole.VIEWER
) {
  const session = await requireAuth()

  const membership = await db.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: session.user!.id
      }
    }
  })

  if (!membership) {
    throw new Error("Access denied: Not a project member")
  }

  const roleHierarchy = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
  if (roleHierarchy[membership.role] < roleHierarchy[minRole]) {
    throw new Error("Access denied: Insufficient permissions")
  }

  return { session, membership }
}

export function hasPermission(
  userRole: ProjectRole | TeamRole,
  requiredRole: ProjectRole | TeamRole
): boolean {
  const projectRoleHierarchy: Record<ProjectRole, number> = {
    [ProjectRole.VIEWER]: 0,
    [ProjectRole.EDITOR]: 1,
    [ProjectRole.ADMIN]: 2
  }
  const teamRoleHierarchy: Record<TeamRole, number> = {
    [TeamRole.MEMBER]: 0,
    [TeamRole.ADMIN]: 1
  }

  const userLevel = userRole in ProjectRole
    ? projectRoleHierarchy[userRole as ProjectRole]
    : teamRoleHierarchy[userRole as TeamRole]
  const requiredLevel = requiredRole in ProjectRole
    ? projectRoleHierarchy[requiredRole as ProjectRole]
    : teamRoleHierarchy[requiredRole as TeamRole]

  return userLevel >= requiredLevel
}
