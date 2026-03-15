import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q') || ''
    const fileId = searchParams.get('fileId')
    const projectId = searchParams.get('projectId')

    if (!query) {
      return NextResponse.json([])
    }

    // Get file to determine project
    let projectIdToUse = projectId

    if (fileId && !projectIdToUse) {
      const file = await db.file.findUnique({
        where: { id: fileId },
        select: { projectId: true }
      })
      if (file) {
        projectIdToUse = file.projectId
      }
    }

    if (!projectIdToUse) {
      return NextResponse.json([])
    }

    // Check user has access to project
    const project = await db.project.findUnique({
      where: { id: projectIdToUse },
      include: {
        members: true
      }
    })

    if (!project) {
      return NextResponse.json([])
    }

    const hasAccess = project.members.some(m => m.userId === session.user.id)
    if (!hasAccess) {
      return NextResponse.json([])
    }

    // Get project members that match query
    const users = await db.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ],
        projectMemberships: {
          some: {
            projectId: projectIdToUse
          }
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true
      },
      take: 10
    })

    return NextResponse.json(users)
  } catch (error) {
    console.error("User search error:", error)
    return NextResponse.json(
      { error: "Failed to search users", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
