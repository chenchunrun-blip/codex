import { requireAuthApi } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { generateContent } from "@/lib/ai/client"
import { TEMPLATE_PROMPTS } from "@/lib/ai/prompts"
import { decrypt } from "@/lib/utils/encryption"
import { NextResponse } from "next/server"
import { TemplateCategory } from "@prisma/client"

/**
 * POST /api/ai/generate - Generate AI content
 * Uses user's stored API key (encrypted) to generate content
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

    const { templateType, projectName, context, action } = await req.json()

    // Get user's API key and configuration using Prisma's type-safe methods
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        openaiApiKey: true,
        aiModel: true,
        aiApiEndpoint: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found", code: "USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (!user.openaiApiKey) {
      return NextResponse.json(
        { error: "API key not configured. Please add it in settings.", code: "AI_API_KEY_MISSING" },
        { status: 400 }
      )
    }

    // Decrypt API key
    const decryptedKey = decrypt(user.openaiApiKey)

    if (!decryptedKey) {
      return NextResponse.json(
        { error: "Failed to decrypt API key. Please re-enter your API key.", code: "AI_API_KEY_INVALID" },
        { status: 500 }
      )
    }

    // Generate prompt based on template type or action
    let prompt = ""
    if (action === "expand") {
      prompt = `Expand and elaborate on the following content. Add more details, examples, and explanations:\n\n${context}`
    } else if (action === "summarize") {
      prompt = `Create a concise summary of the following content:\n\n${context}`
    } else if (action === "improve") {
      prompt = `Improve the following content by enhancing clarity, flow, and professionalism while maintaining the original meaning:\n\n${context}`
    } else if (action === "generate") {
      prompt = context || `Generate content about ${projectName}`
    } else {
      const promptFn = TEMPLATE_PROMPTS[templateType as TemplateCategory]
      if (!promptFn) {
        return NextResponse.json(
          { error: "Invalid template type", code: "INVALID_REQUEST_PAYLOAD" },
          { status: 400 }
        )
      }
      prompt = promptFn(projectName, context)
    }

    // Generate content with user's model and endpoint
    const content = await generateContent(
      decryptedKey,
      prompt,
      {
        model: user.aiModel || "gpt-3.5-turbo",
        baseURL: user.aiApiEndpoint || undefined
      }
    )

    return NextResponse.json({ content })
  } catch (error) {
    console.error("AI generation error:", error)
    // Don't expose error details
    return NextResponse.json(
      { error: "Failed to generate content. Please check your API key and try again.", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
