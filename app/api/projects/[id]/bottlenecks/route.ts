import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import {
  buildProjectBottlenecksMarkdown,
  resolveProjectBottlenecks
} from "@/lib/tasks/project-bottlenecks"
import { NextResponse } from "next/server"

/**
 * GET /api/projects/[id]/bottlenecks
 * Return project bottlenecks for queue + high risk tasks.
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

    const data = await resolveProjectBottlenecks(id)
    const generatedAt = new Date().toISOString()

    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      const markdown = buildProjectBottlenecksMarkdown({
        projectId: id,
        generatedAt,
        data
      })
      return new Response(markdown, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" }
      })
    }

    return NextResponse.json({
      projectId: id,
      generatedAt,
      ...data
    })
  } catch (error) {
    console.error("Project bottlenecks error:", error)
    return NextResponse.json(
      { error: "Failed to fetch project bottlenecks", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
