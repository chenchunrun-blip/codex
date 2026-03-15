import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deriveRecommendedTemplateCategoriesFromCounts } from "@/lib/templates/recommendation"
import { NextResponse } from "next/server"

/**
 * GET /api/projects/[id]/template-recommendations
 * Returns project-specific template recommendations based on file template usage.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const { id } = await params
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: id,
          userId: session.user.id
        }
      }
    })
    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const usageRows = await db.file.groupBy({
      by: ["templateType"],
      where: {
        projectId: id
      },
      _count: { _all: true }
    })
    const recommendedCategories = deriveRecommendedTemplateCategoriesFromCounts({
      items: usageRows.map((row) => ({
        templateType: row.templateType,
        count: row._count._all
      })),
      limit: 3
    })

    const templates = await db.template.findMany({
      where: {
        OR: [{ isPublic: true }, { creatorId: session.user.id }],
        ...(recommendedCategories.length > 0
          ? { category: { in: recommendedCategories } }
          : { isBuiltIn: true })
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
      take: 8
    })

    return NextResponse.json({
      projectId: id,
      recommendationSource: recommendedCategories.length > 0 ? "project_usage" : "builtin_fallback",
      categories: recommendedCategories,
      templates
    })
  } catch (error) {
    console.error("Template recommendation fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch template recommendations", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

