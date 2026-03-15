import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

/**
 * GET /api/users - Get users from user's teams
 * Returns users who are members of teams the current user belongs to
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Get the projectId from query params if provided
    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get("projectId")

    let users

    if (projectId) {
      // Get users who are members of the specific project
      users = await db.user.findMany({
        where: {
          projectMemberships: {
            some: {
              projectId: projectId
            }
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          nickname: true
        },
        orderBy: {
          name: 'asc'
        }
      })
    } else {
      // Get users who are in the same teams as the current user
      const userTeams = await db.teamMember.findMany({
        where: {
          userId: session.user!.id
        },
        select: {
          teamId: true
        }
      })

      const teamIds = userTeams.map(t => t.teamId)

      if (teamIds.length === 0) {
        return NextResponse.json([])
      }

      users = await db.user.findMany({
        where: {
          teamMemberships: {
            some: {
              teamId: {
                in: teamIds
              }
            }
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          nickname: true
        },
        orderBy: {
          name: 'asc'
        }
      })
    }

    return NextResponse.json(users)
  } catch (error) {
    console.error("Users fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch users", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
