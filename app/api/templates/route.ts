import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { templateCreateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { TemplateCategory } from "@prisma/client"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const parsed = templateCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    const template = await db.template.create({
      data: {
        ...validated,
        isBuiltIn: false,
        creatorId: session.user!.id
      }
    })

    return NextResponse.json(template)
  } catch (error) {
    console.error("Template creation error:", error)
    return NextResponse.json(
      { error: "Failed to create template", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category') as TemplateCategory | null
    const query = (searchParams.get("q") || "").trim()
    const visibility = (searchParams.get("visibility") || "ALL").toUpperCase()
    const sort = (searchParams.get("sort") || "BUILTIN_CREATED_DESC").toUpperCase()

    const normalizedCategory =
      category && Object.values(TemplateCategory).includes(category) ? category : null

    const visibilityWhere =
      visibility === "MINE"
        ? { creatorId: session.user!.id }
        : visibility === "PUBLIC"
          ? { isPublic: true }
          : visibility === "BUILT_IN"
            ? { isBuiltIn: true }
            : {
                OR: [
                  { isPublic: true },
                  { creatorId: session.user!.id }
                ]
              }

    const orderBy =
      sort === "NAME_ASC"
        ? [{ name: "asc" as const }]
        : sort === "UPDATED_DESC"
          ? [{ updatedAt: "desc" as const }]
          : [{ isBuiltIn: "desc" as const }, { createdAt: "desc" as const }]

    const templates = await db.template.findMany({
      where: {
        AND: [
          visibilityWhere,
          ...(normalizedCategory ? [{ category: normalizedCategory }] : []),
          ...(query
            ? [
                {
                  OR: [
                    { name: { contains: query, mode: "insensitive" as const } },
                    { description: { contains: query, mode: "insensitive" as const } },
                    { content: { contains: query, mode: "insensitive" as const } }
                  ]
                }
              ]
            : [])
        ]
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
      orderBy
    })

    return NextResponse.json(templates)
  } catch (error) {
    console.error("Templates fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch templates", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
