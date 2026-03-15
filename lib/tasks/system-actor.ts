import { db } from "@/lib/db"

/**
 * Resolve a stable actor user for system/agent-originated writes.
 * Priority:
 * 1) project creator
 * 2) earliest project admin
 * 3) earliest project member
 */
export async function resolveProjectSystemActor(projectId: string): Promise<string | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { creatorId: true }
  })
  if (project?.creatorId) {
    return project.creatorId
  }

  const adminMember = await db.projectMember.findFirst({
    where: {
      projectId,
      role: "ADMIN"
    },
    orderBy: {
      joinedAt: "asc"
    },
    select: {
      userId: true
    }
  })
  if (adminMember?.userId) {
    return adminMember.userId
  }

  const anyMember = await db.projectMember.findFirst({
    where: { projectId },
    orderBy: {
      joinedAt: "asc"
    },
    select: {
      userId: true
    }
  })

  return anyMember?.userId || null
}
