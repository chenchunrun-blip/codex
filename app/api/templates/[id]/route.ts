import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { templateCreateSchema } from "@/lib/utils/validation"
import { NextResponse } from "next/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const template = await db.template.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })
    if (!template) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (!template.isPublic && template.creatorId !== session.user!.id) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error("Template fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch template", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = templateCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const existing = await db.template.findUnique({
      where: { id },
      select: {
        id: true,
        creatorId: true,
        isBuiltIn: true
      }
    })
    if (!existing) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (existing.isBuiltIn) {
      return NextResponse.json(
        { error: "Built-in template cannot be edited", code: "BUILTIN_TEMPLATE_READ_ONLY" },
        { status: 400 }
      )
    }
    if (existing.creatorId !== session.user!.id) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const template = await db.template.update({
      where: { id },
      data: {
        ...parsed.data
      }
    })
    return NextResponse.json(template)
  } catch (error) {
    console.error("Template update error:", error)
    return NextResponse.json(
      { error: "Failed to update template", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    const { id } = await params

    const existing = await db.template.findUnique({
      where: { id },
      select: {
        id: true,
        creatorId: true,
        isBuiltIn: true
      }
    })
    if (!existing) {
      return NextResponse.json(
        { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
        { status: 404 }
      )
    }
    if (existing.isBuiltIn) {
      return NextResponse.json(
        { error: "Built-in template cannot be deleted", code: "BUILTIN_TEMPLATE_READ_ONLY" },
        { status: 400 }
      )
    }
    if (existing.creatorId !== session.user!.id) {
      return NextResponse.json(
        { error: "Insufficient permissions", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    await db.template.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Template delete error:", error)
    return NextResponse.json(
      { error: "Failed to delete template", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

