import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

/**
 * GET /api/deliverables/[id] - Get deliverable details
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const deliverable = await db.deliverable.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
            project: {
              select: {
                name: true
              }
            }
          }
        },
        file: {
          select: {
            id: true,
            name: true,
            content: true,
            fileType: true,
            status: true
          }
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      }
    })

    if (!deliverable) {
      return NextResponse.json(
        { error: "Deliverable not found" },
        { status: 404 }
      )
    }

    // Verify project access
    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: deliverable.task.projectId,
          userId: session.user!.id
        }
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member" },
        { status: 403 }
      )
    }

    return NextResponse.json(deliverable)
  } catch (error) {
    console.error("Deliverable fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch deliverable" },
      { status: 500 }
    )
  }
}
