import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { exportToMarkdown, exportToHTML } from "@/lib/utils/export"
import { NextResponse } from "next/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await auth()

    const file = await db.file.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            members: true
          }
        }
      }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Verify access
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { error: "Not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const hasAccess = file.project.members.some(m => m.userId === session.user!.id!)
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Access denied", code: "INSUFFICIENT_PERMISSIONS" },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'md'

    if (format === 'md') {
      const { filename, content } = await exportToMarkdown(id)

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      })
    } else if (format === 'html') {
      const { filename, content } = await exportToHTML(id)

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      })
    } else if (format === 'pdf') {
      // For PDF export, return HTML with instructions to print/save as PDF
      const { filename, content } = await exportToHTML(id, true)

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="${filename}"`
        }
      })
    } else {
      return NextResponse.json(
        { error: "Invalid format. Use 'md', 'html', or 'pdf'", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error("Export error:", error)
    return NextResponse.json(
      { error: "Failed to export file", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
