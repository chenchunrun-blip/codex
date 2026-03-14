import { requireAuthApi } from "@/lib/auth/rbac"
import {
  buildTeamWorkspaceMarkdown,
  resolveTeamWorkspaceReport
} from "@/lib/teams/workspace-report"
import { NextResponse } from "next/server"

/**
 * GET /api/teams/[id]/workspace-report
 * Query:
 * - format=markdown: return markdown report
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

    const { id: teamId } = await params
    const result = await resolveTeamWorkspaceReport(teamId, session.user.id)

    if (!result.isMember) {
      return NextResponse.json(
        { error: "Not a team member", code: "NOT_TEAM_MEMBER" },
        { status: 403 }
      )
    }

    if (!result.found) {
      return NextResponse.json(
        { error: "Team not found", code: "TEAM_NOT_FOUND" },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get("format") === "markdown") {
      return new Response(buildTeamWorkspaceMarkdown(result.payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }

    return NextResponse.json(result.payload)
  } catch (error) {
    console.error("Team workspace report error:", error)
    return NextResponse.json(
      { error: "Failed to fetch team workspace report", code: "TEAM_WORKSPACE_REPORT_FAILED" },
      { status: 500 }
    )
  }
}
