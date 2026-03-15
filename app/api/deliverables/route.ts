import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { deliverableCreateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"
import { ProjectRole, NotificationType, DeliverableStatus } from "@prisma/client"

/**
 * GET /api/deliverables - Get deliverable list
 * Query params: taskId (required)
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const taskId = searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    // Verify access to the task's project
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true
      }
    })

    if (!task) {
      return NextResponse.json(
        { error: "Task not found", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: task.projectId,
          userId: session.user!.id
        }
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    const deliverables = await db.deliverable.findMany({
      where: { taskId },
      include: {
        task: {
          select: {
            id: true,
            title: true
          }
        },
        file: {
          select: {
            id: true,
            name: true,
            fileType: true
          }
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            nickname: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(deliverables)
  } catch (error) {
    console.error("Deliverables fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch deliverables", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/deliverables - Create deliverable
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const parsed = deliverableCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }
    const validated = parsed.data

    // Verify access to the task's project
    const task = await db.task.findUnique({
      where: { id: validated.taskId },
      include: {
        project: true
      }
    })

    if (!task) {
      return NextResponse.json(
        { error: "Task not found", code: "TASK_NOT_FOUND" },
        { status: 404 }
      )
    }

    const membership = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: task.projectId,
          userId: session.user!.id
        }
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: "Not a project member", code: "NOT_PROJECT_MEMBER" },
        { status: 403 }
      )
    }

    // Optionally create a file if requested
    let fileId: string | undefined
    if (validated.createFile) {
      const file = await db.file.create({
        data: {
          name: validated.name,
          content: validated.content,
          fileType: "CUSTOM",
          status: "DRAFT",
          creatorId: session.user!.id,
          projectId: task.projectId,
          storageId: crypto.randomUUID()
        }
      })
      fileId = file.id
    }

    const deliverable = await db.deliverable.create({
      data: {
        taskId: validated.taskId,
        fileId,
        name: validated.name,
        type: validated.type,
        content: validated.content,
        status: DeliverableStatus.SUBMITTED,
        submittedAt: new Date()
      },
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
            fileType: true
          }
        }
      }
    })

    // Notify project editors and admins about the deliverable
    const projectMembers = await db.projectMember.findMany({
      where: {
        projectId: task.projectId,
        role: { in: [ProjectRole.EDITOR, ProjectRole.ADMIN] },
        userId: { not: session.user!.id }
      },
      include: {
        user: {
          select: { id: true }
        }
      }
    })

    for (const member of projectMembers) {
      await db.notification.create({
        data: {
          userId: member.userId,
          type: NotificationType.DELIVERABLE_READY,
          title: "New Deliverable Submitted",
          content: `A new deliverable "${validated.name}" has been submitted for task "${task.title}"`,
          link: `/projects/${task.projectId}/tasks/${task.id}/deliverables/${deliverable.id}`
        }
      })
    }

    return NextResponse.json(deliverable, { status: 201 })
  } catch (error) {
    console.error("Deliverable creation error:", error)
    return NextResponse.json(
      { error: "Failed to create deliverable", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
