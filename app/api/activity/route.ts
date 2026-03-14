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
    const projectId = searchParams.get('projectId')
    const fileId = searchParams.get('fileId')
    const rawLimit = searchParams.get("limit") || "50"
    const limit = Number.parseInt(rawLimit, 10)
    if (Number.isNaN(limit) || limit < 1 || limit > 200) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const memberships = await db.projectMember.findMany({
      where: { userId: session.user.id },
      select: { projectId: true }
    })
    const accessibleProjectIds = memberships.map((item) => item.projectId)
    if (accessibleProjectIds.length === 0) {
      return NextResponse.json({
        activities: [],
        count: 0,
        hasMore: false
      })
    }

    // Build where clause
    const where: any = {}

    if (projectId) {
      if (!accessibleProjectIds.includes(projectId)) {
        return NextResponse.json(
          { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
          { status: 403 }
        )
      }
      where.projectId = projectId
    } else {
      where.projectId = { in: accessibleProjectIds }
    }

    if (fileId) {
      const file = await db.file.findUnique({
        where: { id: fileId },
        select: { id: true, projectId: true }
      })
      if (!file) {
        return NextResponse.json(
          { error: "File not found", code: "FILE_NOT_FOUND" },
          { status: 404 }
        )
      }
      if (!accessibleProjectIds.includes(file.projectId)) {
        return NextResponse.json(
          { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
          { status: 403 }
        )
      }
      where.fileId = fileId
      where.projectId = file.projectId
    }

    // Get activities
    const activities = await db.activityLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        file: {
          select: {
            id: true,
            name: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    })

    // Get count
    const count = await db.activityLog.count({ where })

    return NextResponse.json({
      activities,
      count,
      hasMore: activities.length === limit
    })
  } catch (error) {
    console.error("Activity log fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch activity log", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
