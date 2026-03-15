"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import rehypeHighlight from "rehype-highlight"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface AIAssistantProps {
  fileId: string
  projectId: string
  fileName: string
  projectName: string
  currentContent: string
}

type GenerationState = "idle" | "generating" | "preview"

export function AIAssistant({ fileId, projectId, fileName, projectName, currentContent }: AIAssistantProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [state, setState] = useState<GenerationState>("idle")
  const [action, setAction] = useState("")
  const [prompt, setPrompt] = useState("")
  const [generatedContent, setGeneratedContent] = useState("")
  const [editedContent, setEditedContent] = useState("")
  const [newFileName, setNewFileName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actions = [
    { id: "expand", label: "✍️ Expand Content", hint: "Elaborate on current content" },
    { id: "summarize", label: "📝 Summarize", hint: "Create a summary" },
    { id: "improve", label: "✨ Improve Writing", hint: "Enhance clarity and flow" },
    { id: "generate", label: "🤖 Generate from Scratch", hint: "Generate new content" },
  ]

  const handleAction = async (actionId: string) => {
    setError(null)
    if (!currentContent && actionId !== "generate") {
      setError("Please write some content first, or choose 'Generate from Scratch'")
      return
    }

    setAction(actionId)
    setState("generating")

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateType: "CUSTOM",
          projectName,
          context: currentContent || prompt || `Generate a new document about ${prompt}`,
          action: actionId,
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, "AI generation failed. Please check your API key in Settings."))
        setState("idle")
        return
      }

      const result = await response.json()
      setGeneratedContent(result.content)
      setEditedContent(result.content)
      // Generate default file name based on action and original file name
      const defaultName = `${fileName.replace(/\.md$/, '')}-${getActionSuffix(action)}.md`
      setNewFileName(defaultName)
      setState("preview")
    } catch (error) {
      console.error("AI error:", error)
      setError(error instanceof Error ? error.message : "AI generation failed")
      setState("idle")
    }
  }

  const handleAccept = async () => {
    setError(null)
    if (!newFileName.trim()) {
      setError("Please enter a file name")
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFileName,
          content: editedContent,
          projectId: projectId
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, "Failed to create file"))
        setIsSaving(false)
        return
      }

      const newFile = await response.json()

      // Close modal and navigate to new file
      handleClose()
      router.push(`/editor/${newFile.id}`)
    } catch (error) {
      console.error("File creation error:", error)
      setError(error instanceof Error ? error.message : "Failed to create file")
      setIsSaving(false)
    }
  }

  const handleReject = () => {
    handleClose()
  }

  const handleClose = () => {
    setIsOpen(false)
    setState("idle")
    setAction("")
    setPrompt("")
    setGeneratedContent("")
    setEditedContent("")
    setNewFileName("")
    setIsSaving(false)
    setError(null)
  }

  const getActionTitle = () => {
    switch (action) {
      case "expand": return "Expand Content"
      case "summarize": return "Summarize"
      case "improve": return "Improve Writing"
      case "generate": return "Generate from Scratch"
      default: return "AI Generated Content"
    }
  }

  const getActionSuffix = (actionId: string) => {
    switch (actionId) {
      case "expand": return "expanded"
      case "summarize": return "summary"
      case "improve": return "improved"
      case "generate": return "ai-generated"
      default: return "revision"
    }
  }

  return (
    <>
      {/* AI Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-300 rounded hover:bg-purple-100 transition-all"
        title="AI Assistant"
      >
        🤖 AI Assist
      </button>

      {/* AI Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">🤖 AI Assistant</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {state === "preview" ? "Review and decide whether to use the AI-generated content" : "Choose an action to get AI help with your document"}
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              {error && (
                <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {state === "generating" && (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
                  <p className="text-gray-600">AI is generating content...</p>
                  <p className="text-sm text-gray-500 mt-2">This may take a few seconds</p>
                </div>
              )}

              {state === "idle" && (
                <div className="p-6 space-y-4">
                  {/* Custom Prompt */}
                  {action === "generate" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        What do you want to create?
                      </label>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        rows={3}
                        placeholder="e.g., A project status report for the Q1 marketing campaign"
                      />
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {actions.map((act) => (
                      <button
                        key={act.id}
                        onClick={() => handleAction(act.id)}
                        className="p-4 text-left border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                      >
                        <div className="font-semibold text-gray-900">{act.label}</div>
                        <div className="text-sm text-gray-600 mt-1">{act.hint}</div>
                      </button>
                    ))}
                  </div>

                  {/* Info Box */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                    <h4 className="font-semibold text-blue-900 mb-2">💡 Tips</h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Make sure you've added your API key in Settings</li>
                      <li>• AI works best with clear, specific context</li>
                      <li>• You can review and edit the generated content before applying</li>
                      <li>• Supports OpenAI GPT-4, GPT-3.5, Zhipu AI, and compatible APIs</li>
                    </ul>
                  </div>
                </div>
              )}

              {state === "preview" && (
                <div className="flex flex-col h-full">
                  {/* Action Title and File Name Input */}
                  <div className="px-6 py-3 bg-purple-50 border-b border-purple-200">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <h3 className="font-semibold text-purple-900 break-words">{getActionTitle()}</h3>
                      <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none">
                        <label className="text-sm text-purple-700 whitespace-nowrap">New file name:</label>
                        <input
                          type="text"
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          className="px-3 py-1 text-sm border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 w-full sm:w-auto min-w-[200px]"
                          placeholder="new-file-name.md"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Comparison View */}
                  <div className="flex flex-col md:flex-row h-[600px]">
                    {/* Original Content */}
                    <div className="flex-1 border-r border-gray-200 flex flex-col min-w-0">
                      <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
                        <span className="text-sm font-semibold text-gray-700 break-words">📄 Original Content</span>
                      </div>
                      <div className="flex-1 p-4 overflow-auto">
                        <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-full prose prose-sm max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            rehypePlugins={[rehypeHighlight]}
                          >
                            {currentContent || "*No content*"}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>

                    {/* AI Generated Content */}
                    <div className="flex-1 flex flex-col min-w-0">
                      <div className="px-4 py-2 bg-blue-100 border-b border-blue-200">
                        <span className="text-sm font-semibold text-blue-700 break-words">🤖 AI Generated (Editable)</span>
                      </div>
                      <div className="flex-1 p-4 overflow-auto">
                        <textarea
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          className="w-full h-full p-4 border border-gray-200 rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="AI-generated content will appear here..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Comparison Stats */}
                  <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-6">
                        <span className="text-gray-600">
                          Original: <strong>{currentContent.length} chars</strong>
                        </span>
                        <span className="text-blue-600">
                          Generated: <strong>{editedContent.length} chars</strong>
                        </span>
                        <span className="text-purple-600">
                          Change: <strong>{editedContent.length - currentContent.length > 0 ? '+' : ''}{editedContent.length - currentContent.length} chars</strong>
                        </span>
                      </div>
                      <button
                        onClick={() => setEditedContent(generatedContent)}
                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        Reset to original AI output
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              {state === "idle" && (
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              )}

              {state === "preview" && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReject}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                  >
                    ❌ Reject
                  </button>
                  <button
                    onClick={handleAccept}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 font-medium disabled:opacity-50"
                  >
                    {isSaving ? "💾 Creating..." : "✅ Save as New File"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
