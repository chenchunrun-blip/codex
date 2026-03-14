import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { resolveAgentQueueStatus } from "@/lib/agents/queue-status"
import { NextResponse } from "next/server"

function buildQueueStatusMarkdown(input: {
  projectId: string | null
  domains: Array<{
    domain: string
    backlog: number
    activeAgents: number
    onlineAgents: number
  }>
  degraded?: boolean
  error?: string
}) {
  const rows =
    input.domains.length === 0
      ? "- No queue domains found"
      : input.domains
          .map(
            (item) =>
              `- ${item.domain}: backlog=${item.backlog}, activeAgents=${item.activeAgents}, onlineAgents=${item.onlineAgents}`
          )
          .join("\n")

  return `# Agent Queue Status

- Generated At: ${new Date().toISOString()}
- Project ID: ${input.projectId || "ALL_ACCESSIBLE"}
- Degraded: ${input.degraded ? "yes" : "no"}
${input.error ? `- Error: ${input.error}` : ""}

## Domains
${rows}
`
}

/**
 * GET /api/agents/queue-status
 * Query: projectId (optional)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get("projectId")
  const wantsMarkdown = searchParams.get("format") === "markdown"
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    if (projectId) {
      const membership = await db.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
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
    }

    const payload = await resolveAgentQueueStatus(projectId || undefined)
    if (wantsMarkdown) {
      return new Response(buildQueueStatusMarkdown(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }
    return NextResponse.json(payload)
  } catch (error) {
    console.error("Queue status error:", error)
    const fallbackPayload = {
      projectId: projectId || null,
      domains: [],
      degraded: true,
      error: "Failed to fetch queue status",
      code: "INTERNAL_ERROR"
    }
    if (wantsMarkdown) {
      return new Response(buildQueueStatusMarkdown(fallbackPayload), {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8"
        }
      })
    }
    return NextResponse.json(fallbackPayload, { status: 200 })
  }
}
