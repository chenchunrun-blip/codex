"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import rehypeHighlight from "rehype-highlight"
import { AIAssistant } from "@/components/editor/ai-assistant"

interface MarkdownEditorProps {
  fileId: string
  projectId: string
  fileName: string
  initialContent: string
  projectName?: string
  readOnly?: boolean
}

export function MarkdownEditor({ fileId, projectId, fileName, initialContent, projectName = "Project", readOnly = false }: MarkdownEditorProps) {
  const router = useRouter()
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [activeUsers, setActiveUsers] = useState<Array<{ name: string; color: string }>>([])

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (content !== initialContent && !readOnly) {
        await saveContent()
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [content, initialContent, readOnly])

  const saveContent = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`/api/files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      })

      if (response.ok) {
        setLastSaved(new Date())
      }
    } catch (error) {
      console.error("Failed to save:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const insertMarkdown = (before: string, after: string = "") => {
    const textarea = document.getElementById("markdown-input") as HTMLTextAreaElement
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = textarea.value
      const selectedText = text.substring(start, end)

      const newText = text.substring(0, start) + before + selectedText + after + text.substring(end)
      setContent(newText)

      setTimeout(() => {
        textarea.focus()
        const newCursorPos = start + before.length + selectedText.length
        textarea.selectionStart = textarea.selectionEnd = newCursorPos
      }, 0)
    }
  }

  const toolbarButtons = [
    {
      label: "H1",
      icon: "H1",
      action: () => insertMarkdown("# ", ""),
      hint: "Heading 1",
      className: "text-lg font-bold"
    },
    {
      label: "H2",
      icon: "H2",
      action: () => insertMarkdown("## ", ""),
      hint: "Heading 2",
      className: "text-base font-bold"
    },
    {
      label: "H3",
      icon: "H3",
      action: () => insertMarkdown("### ", ""),
      hint: "Heading 3",
      className: "text-sm font-bold"
    },
    {
      label: "Bold",
      icon: "B",
      action: () => insertMarkdown("**", "**"),
      hint: "Bold (Ctrl+B)",
      className: "font-bold"
    },
    {
      label: "Italic",
      icon: "I",
      action: () => insertMarkdown("*", "*"),
      hint: "Italic (Ctrl+I)",
      className: "italic"
    },
    {
      label: "Strikethrough",
      icon: "S",
      action: () => insertMarkdown("~~", "~~"),
      hint: "Strikethrough",
      className: "line-through"
    },
    {
      label: "Code",
      icon: "<>",
      action: () => insertMarkdown("`", "`"),
      hint: "Inline Code",
      className: "font-mono text-xs"
    },
    {
      label: "Link",
      icon: "🔗",
      action: () => insertMarkdown("[", "](url)"),
      hint: "Link",
      className: ""
    },
    {
      label: "List",
      icon: "•",
      action: () => insertMarkdown("- ", ""),
      hint: "Bullet List",
      className: ""
    },
    {
      label: "Num",
      icon: "1.",
      action: () => insertMarkdown("1. ", ""),
      hint: "Numbered List",
      className: ""
    },
    {
      label: "Quote",
      icon: ">",
      action: () => insertMarkdown("> ", ""),
      hint: "Blockquote",
      className: ""
    },
    {
      label: "Code Block",
      icon: "{}",
      action: () => insertMarkdown("\n```\n", "\n```\n"),
      hint: "Code Block",
      className: "font-mono text-xs"
    },
    {
      label: "Table",
      icon: "▦�",
      action: () => insertMarkdown("\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n"),
      hint: "Table",
      className: ""
    },
    {
      label: "HR",
      icon: "—",
      action: () => insertMarkdown("\n---\n"),
      hint: "Horizontal Rule",
      className: ""
    },
  ]

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-1 flex-wrap">
            {toolbarButtons.map((button) => (
              <button
                key={button.label}
                onClick={button.action}
                className={`px-3 py-2 text-sm font-medium text-gray-800 bg-white border border-gray-300 rounded hover:bg-gray-100 hover:border-gray-400 transition-all ${button.className}`}
                title={button.hint}
              >
                {button.icon}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <AIAssistant
              fileId={fileId}
              projectId={projectId}
              fileName={fileName}
              projectName={projectName}
              currentContent={content}
            />

            <button
              onClick={() => setShowPreview(!showPreview)}
              className="px-4 py-2 text-sm font-medium text-gray-800 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
            >
              {showPreview ? "Edit Only" : "Split View"}
            </button>

            <button
              onClick={saveContent}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Collaborators */}
      {activeUsers.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-200">
          <span className="text-sm text-blue-900 font-medium">Currently editing:</span>
          <div className="flex -space-x-2">
            {activeUsers.map((user, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 border-white"
                style={{ backgroundColor: user.color }}
                title={user.name}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Markdown Input - Left Side */}
        <div className={`${showPreview ? "w-1/2" : "w-full"} border-r-4 border-gray-300 flex flex-col bg-white`}>
          {/* Edit Header */}
          <div className="px-4 py-2 bg-gray-100 border-b-2 border-gray-300">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2h2.828l-8.586-8.586z" />
              </svg>
              <span className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Markdown Editor</span>
            </div>
          </div>

          <textarea
            id="markdown-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={readOnly}
            className="flex-1 w-full p-6 font-mono text-base text-gray-900 resize-none focus:outline-none bg-white leading-relaxed border-none"
            placeholder="Start writing your Markdown here..."
            style={{ minHeight: '400px' }}
          />

          {/* Input Status Bar */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-300 text-xs text-gray-700 flex items-center justify-between">
            <span className="font-medium">RAW MARKDOWN</span>
            <span>{content.length} chars • {content.split("\n").length} lines</span>
          </div>
        </div>

        {/* Preview - Right Side */}
        {showPreview && (
          <div className="w-1/2 overflow-auto flex flex-col bg-stone-50">
            {/* Preview Header */}
            <div className="px-4 py-2 bg-stone-200 border-b-2 border-stone-300">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className="text-sm font-semibold text-stone-800 uppercase tracking-wide">Preview</span>
              </div>
            </div>

            <div className="flex-1 p-8 prose prose-sm max-w-none prose-headings:font-bold prose-headings:text-black prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-black prose-strong:text-black prose-em:text-gray-900 prose-code:text-rose-700 prose-code:bg-rose-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-stone-900 prose-pre:text-stone-100 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-4 prose-blockquote:border-gray-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-900 prose-table:border-collapse prose-table:border-gray-400 prose-th:bg-stone-200 prose-th:font-bold prose-th:text-black prose-td:border prose-td:border-gray-400 prose-td:p-2 prose-td:text-black prose-hr:border-gray-400 prose-li:text-black">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeHighlight]}
              >
                {content}
              </ReactMarkdown>
            </div>

            {/* Preview Status Bar */}
            <div className="px-4 py-2 bg-stone-100 border-t border-stone-300 text-xs text-stone-700 flex items-center justify-between">
              <span className="font-medium">RENDERED OUTPUT</span>
              <span>{content.split(/\s+/).filter(Boolean).length} words</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-700">
        <div className="flex items-center gap-4">
          <span>Markdown Format</span>
          <span>•</span>
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
          <span>•</span>
          <span>{content.length} characters</span>
          <span>•</span>
          <span>{content.split("\n").length} lines</span>
        </div>

        <div className="flex items-center gap-4">
          {lastSaved && (
            <span className="text-green-600">✓ Last saved: {lastSaved.toLocaleTimeString()}</span>
          )}
          {isSaving && (
            <span className="text-blue-600">Saving...</span>
          )}
        </div>
      </div>
    </div>
  )
}
