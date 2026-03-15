import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { teamCreateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { TeamRole } from "@prisma/client"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const parsed = teamCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    const team = await db.team.create({
      data: {
        ...validated,
        creatorId: session.user!.id,
        members: {
          create: {
            userId: session.user!.id,
            role: TeamRole.ADMIN
          }
        }
      },
      include: {
        members: {
          include: { user: true }
        }
      }
    })

    return NextResponse.json(team)
  } catch (error) {
    console.error("Team creation error:", error)
    return NextResponse.json(
      { error: "Failed to create team", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const query = (searchParams.get("q") || "").trim()
    const sort = (searchParams.get("sort") || "CREATED_DESC").toUpperCase()

    const teams = await db.team.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } }
              ]
            }
          : {}),
        members: {
          some: {
            userId: session.user!.id
          }
        }
      },
      include: {
        members: {
          include: { user: true }
        },
        _count: {
          select: {
            projects: true
          }
        }
      },
      orderBy: sort === "NAME_ASC" ? { name: "asc" } : { createdAt: "desc" }
    })

    const sortedTeams =
      sort === "MEMBERS_DESC"
        ? [...teams].sort((a, b) => b.members.length - a.members.length)
        : sort === "PROJECTS_DESC"
          ? [...teams].sort((a, b) => b._count.projects - a._count.projects)
          : teams

    return NextResponse.json(sortedTeams)
  } catch (error) {
    console.error("Teams fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch teams", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
