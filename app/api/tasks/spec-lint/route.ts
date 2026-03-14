import { requireAuthApi } from "@/lib/auth/rbac"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { NextResponse } from "next/server"
import { z } from "zod"

const payloadSchema = z.object({
  markdown: z.string().min(1, "markdown is required")
})

/**
 * POST /api/tasks/spec-lint
 * Analyze TaskSpec markdown quality and return lint result.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuthApi()
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = payloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", code: "INVALID_REQUEST_PAYLOAD", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = lintTaskSpecMarkdown(parsed.data.markdown)
    return NextResponse.json(result)
  } catch (error) {
    console.error("TaskSpec lint error:", error)
    return NextResponse.json(
      { error: "Failed to lint task spec", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
