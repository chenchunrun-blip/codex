import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { TeamRole } from "@prisma/client"

/**
 * GET /api/fix-schema - Check and add missing database columns
 *
 * SECURITY: This endpoint is restricted to team admins only.
 * This is a migration helper that should ideally be run via Prisma migrations.
 *
 * @deprecated Use Prisma migrations instead
 */
export async function GET() {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Only allow team admins to access this endpoint
    const adminMembership = await db.teamMember.findFirst({
      where: {
        userId: session.user.id,
        role: TeamRole.ADMIN
      }
    })

    if (!adminMembership) {
      return NextResponse.json(
        { error: "Forbidden: Only team admins can access this endpoint", code: "TEAM_ADMIN_REQUIRED" },
        { status: 403 }
      )
    }

    // Check if columns exist by attempting to query them
    const result = await db.$queryRaw`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'User'
      AND column_name IN ('aiModel', 'aiApiEndpoint')
      ORDER BY column_name
    ` as { column_name: string; data_type: string; column_default: string | null }[]

    // If columns don't exist, add them
    if (!result || result.length === 0) {
      await db.$executeRaw`
        ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS "aiApiEndpoint" TEXT,
        ADD COLUMN IF NOT EXISTS "aiModel" TEXT DEFAULT 'gpt-3.5-turbo'
      `

      return NextResponse.json({
        success: true,
        message: "Columns added successfully",
        action: "added"
      })
    }

    return NextResponse.json({
      success: true,
      message: "Columns already exist",
      action: "checked"
    })
  } catch (error) {
    console.error('Schema fix error:', error)
    // Don't expose error details in production
    return NextResponse.json({
      success: false,
      error: "Failed to check or update schema",
      code: "INTERNAL_ERROR"
    }, { status: 500 })
  }
}
