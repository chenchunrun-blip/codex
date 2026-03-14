import { requireAuth, requireProjectAccess } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"

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
    const parsed = body as {
      fileId?: unknown
      content?: unknown
      changeLog?: unknown
    }
    const fileId = typeof parsed.fileId === "string" ? parsed.fileId : ""
    const content = typeof parsed.content === "string" ? parsed.content : null
    const changeLog =
      typeof parsed.changeLog === "string" || parsed.changeLog === null || parsed.changeLog === undefined
        ? parsed.changeLog
        : null
    if (!fileId || content === null) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Verify file access
    const file = await db.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    await requireProjectAccess(file.projectId, "EDITOR")

    // Get current version number
    const latestVersion = await db.fileVersion.findFirst({
      where: { fileId },
      orderBy: { versionNumber: 'desc' }
    })

    const versionNumber = (latestVersion?.versionNumber || 0) + 1

    const version = await db.fileVersion.create({
      data: {
        fileId,
        versionNumber,
        content,
        changeLog,
        creatorId: session.user!.id
      },
      include: {
        creator: true
      }
    })

    // Log activity
    await db.activityLog.create({
      data: {
        projectId: file.projectId,
        fileId,
        userId: session.user!.id,
        action: "FILE_UPDATED",
        metadata: { versionNumber }
      }
    })

    return NextResponse.json(version)
  } catch (error) {
    console.error("Version creation error:", error)
    return NextResponse.json(
      { error: "Failed to create version", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth()
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json(
        { error: "Invalid query parameters", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    const file = await db.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return NextResponse.json(
        { error: "File not found", code: "FILE_NOT_FOUND" },
        { status: 404 }
      )
    }

    await requireProjectAccess(file.projectId)

    const versions = await db.fileVersion.findMany({
      where: { fileId },
      include: {
        creator: true
      },
      orderBy: {
        versionNumber: 'desc'
      }
    })

    return NextResponse.json(versions)
  } catch (error) {
    console.error("Versions fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch versions", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
