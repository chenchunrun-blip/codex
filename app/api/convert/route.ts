import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { generateContent } from "@/lib/ai/client"
import { decrypt } from "@/lib/utils/encryption"
import mammoth from 'mammoth'

// Mammoth types (inline since no @types package exists)
interface MammothOptions {
  arrayBuffer: ArrayBuffer
  styleMap?: string[]
}

interface MammothResult<T> {
  value: T
  messages: Array<{ type: string; message: string }>
}

// File size limit: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const format = formData.get('format') as string // 'markdown' or 'html'
    const useAI = formData.get('useAI') as string // 'fast' or 'ai'

    if (!file) {
      return NextResponse.json(
        { error: "No file provided", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          code: "FILE_TOO_LARGE",
          maxSize: MAX_FILE_SIZE,
          actualSize: file.size
        },
        { status: 413 }
      )
    }

    const fileName = file.name.toLowerCase()
    let content = ""
    let convertedFormat = "text"
    let aiUsed = false

    // Handle different file types
    if (fileName.endsWith('.md') || fileName.endsWith('.markdown') || fileName.endsWith('.txt')) {
      // For markdown and txt, just read as text
      const buffer = await file.arrayBuffer()
      content = Buffer.from(buffer).toString('utf-8')
      convertedFormat = "markdown"
    } else if (fileName.endsWith('.docx')) {
      // For Word documents, use mammoth to convert
      const buffer = await file.arrayBuffer()
      const bufferUint8Array = new Uint8Array(buffer)

      if (format === 'markdown') {
        // Convert to markdown-like format (raw text with basic formatting)
        const result = await mammoth.extractRawText({ arrayBuffer: buffer })
        let rawText = result.value

        // Check if AI conversion is requested
        if (useAI === 'ai') {
          // Use AI to enhance the conversion
          content = await convertWithAI(rawText)
          aiUsed = true
        } else {
          // Use rule-based conversion
          content = convertToMarkdown(rawText)
        }
      } else {
        // Convert to HTML
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
        content = result.value
        convertedFormat = "html"
      }
    } else {
      return NextResponse.json(
        {
          error: "Unsupported file type. Please use .md, .txt, or .docx files.",
          code: "UNSUPPORTED_FILE_TYPE"
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      content,
      format: convertedFormat,
      originalFileName: file.name,
      aiUsed
    })
  } catch (error) {
    console.error("File conversion error:", error)
    return NextResponse.json(
      {
        error: "Failed to convert file",
        code: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

// Helper function to convert extracted text to basic markdown
function convertToMarkdown(text: string): string {
  let lines = text.split('\n')
  let result: string[] = []
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (!line) {
      if (inList) {
        inList = false
      }
      result.push('')
      continue
    }

    // Detect numbered lists
    if (/^[\d]+\.\s/.test(line)) {
      if (!inList) {
        inList = true
      }
      result.push(line)
      continue
    }

    // Detect potential headings (short lines, possibly ALL CAPS)
    if (line.length < 80 && line === line.toUpperCase() && /^[A-Z\s\d]+$/.test(line)) {
      result.push(`\n## ${line}\n`)
      continue
    }

    // Detect bullet points or list items
    if (/^[•\-\*]\s/.test(line) || /^\w+[.\)]\s/.test(line)) {
      if (!inList) {
        inList = true
      }
      result.push(line.replace(/^[•\*]\s/, '- '))
      continue
    }

    // Regular paragraph
    if (inList) {
      inList = false
    }
    result.push(line)
  }

  return result.join('\n')
}

// Convert text to Markdown using AI
async function convertWithAI(text: string): Promise<string> {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      throw new Error("User not authenticated")
    }

    // Get user's AI configuration using raw SQL
    const result = await db.$queryRawUnsafe(`
      SELECT "openaiApiKey", "aiModel", "aiApiEndpoint"
      FROM "User"
      WHERE id = $1
    `, session.user.id) as any[]

    if (!result || result.length === 0) {
      throw new Error("User not found")
    }

    const user = result[0]

    if (!user.openaiApiKey) {
      // If no API key configured, fall back to rule-based conversion
      return convertToMarkdown(text)
    }

    // Decrypt API key
    const decryptedKey = decrypt(user.openaiApiKey)

    // Use AI to convert to well-formatted Markdown
    const prompt = `Convert the following text to well-formatted Markdown. Follow these guidelines:

1. Identify and use proper heading levels (# ## ###) based on document structure
2. Convert tables to Markdown table format
3. Preserve list formatting (both numbered and bulleted)
4. Identify and apply text formatting (bold, italic, code)
5. Maintain proper paragraph spacing
6. Remove excessive blank lines
7. Preserve the original meaning and content structure

Text to convert:
${text}

Return ONLY the Markdown content, no explanations.`

    const markdown = await generateContent(
      decryptedKey,
      prompt,
      {
        model: user.aiModel || "gpt-3.5-turbo",
        baseURL: user.aiApiEndpoint || undefined
      }
    )

    return markdown.trim()
  } catch (error) {
    console.error("AI conversion error, falling back to rule-based:", error)
    // Fall back to rule-based conversion if AI fails
    return convertToMarkdown(text)
  }
}
