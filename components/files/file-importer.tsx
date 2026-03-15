"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Project {
  id: string
  name: string
  team: {
    name: string
  }
}

interface FileImporterProps {
  userId: string
  projects: Project[]
}

type ConversionStatus = "idle" | "converting" | "success" | "error"
type ConversionMode = "fast" | "ai"

const ACCEPTED_FILE_TYPES = [
  ".md",
  ".markdown",
  ".txt",
  ".docx"
]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const FILE_TYPE_DESCRIPTIONS = {
  ".md": "Markdown File",
  ".markdown": "Markdown File",
  ".txt": "Plain Text",
  ".docx": "Word Document (will be converted)"
}

export function FileImporter({ userId, projects }: FileImporterProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversionStatus, setConversionStatus] = useState<ConversionStatus>("idle")
  const [conversionMessage, setConversionMessage] = useState("")
  const [originalFileName, setOriginalFileName] = useState("")
  const [fileName, setFileName] = useState("")
  const [content, setContent] = useState("")
  const [conversionMode, setConversionMode] = useState<ConversionMode>("fast")
  const [formData, setFormData] = useState({
    name: "",
    projectId: "",
    fileType: "CUSTOM"
  })

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB. Please select a smaller file.`)
      return
    }

    // Check file type
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_FILE_TYPES.includes(fileExtension)) {
      setError(`Please select a supported file type: ${ACCEPTED_FILE_TYPES.join(', ')}`)
      return
    }

    setOriginalFileName(file.name)
    setConversionStatus("converting")

    const modeText = conversionMode === "ai" ? "AI-enhanced" : "Fast"
    setConversionMessage(`${modeText} converting ${FILE_TYPE_DESCRIPTIONS[fileExtension as keyof typeof FILE_TYPE_DESCRIPTIONS]} to Markdown...`)

    try {
      // For .md and .txt files, read directly
      if (fileExtension === '.md' || fileExtension === '.markdown' || fileExtension === '.txt') {
        const reader = new FileReader()
        reader.onload = (e) => {
          const text = e.target?.result as string
          setContent(text)
          setFileName(file.name)
          // Auto-fill name from filename without extension
          const nameFromFileName = file.name.replace(/\.(md|markdown|txt)$/, '').replace(/[-_]/g, ' ')
          setFormData({ ...formData, name: nameFromFileName })
          setConversionStatus("success")
          setConversionMessage(`Successfully loaded ${file.name}`)
        }
        reader.readAsText(file)
      } else if (fileExtension === '.docx') {
        // For .docx files, use conversion API
        const uploadFormData = new FormData()
        uploadFormData.append('file', file)
        uploadFormData.append('format', 'markdown')
        uploadFormData.append('useAI', conversionMode)

        const response = await fetch('/api/convert', {
          method: 'POST',
          body: uploadFormData
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(mapReportApiErrorFromPayload(payload, "Conversion failed"))
        }

        const result = await response.json()
        setContent(result.content)
        setFileName(result.originalFileName)
        // Auto-fill name from filename without .docx
        const nameFromFileName = result.originalFileName.replace(/\.docx$/i, '').replace(/[-_]/g, ' ')
        setFormData({ ...formData, name: nameFromFileName })

        if (result.aiUsed) {
          setConversionStatus("success")
          setConversionMessage(`AI-enhanced conversion completed: ${result.originalFileName}`)
        } else {
          setConversionStatus("success")
          setConversionMessage(`Successfully converted ${result.originalFileName} to Markdown`)
        }
      }
    } catch (error) {
      console.error("File conversion error:", error)
      setConversionStatus("error")
      const message = error instanceof Error ? error.message : "Failed to convert file"
      setConversionMessage(message)
      setError(message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!content) {
      setError("Please select a file first")
      return
    }

    if (!formData.projectId) {
      setError("Please select a project")
      return
    }

    setIsUploading(true)

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          content
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, "Failed to import file"))
        return
      }

      const result = await response.json()

      // Redirect to the editor with the new file
      router.push(`/editor/${result.id}`)
    } catch (error) {
      console.error("Upload error:", error)
      setError("Failed to import file")
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = () => {
    setOriginalFileName("")
    setFileName("")
    setContent("")
    setConversionStatus("idle")
    setConversionMessage("")
    setFormData({ ...formData, name: "" })
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="text-6xl mb-4">📁</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No Projects Found</h3>
        <p className="text-gray-600 mb-6">You need to create or join a project first</p>
        <button
          onClick={() => router.push('/projects')}
          className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go to Projects
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {/* File Upload */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">1. Select File</h2>
        <p className="text-sm text-gray-600 mb-4">
          Supported formats: Markdown (.md), Plain Text (.txt), Word Documents (.docx)
        </p>

        {/* Conversion Mode Selection */}
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Conversion Mode
          </label>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="conversionMode"
                value="fast"
                checked={conversionMode === "fast"}
                onChange={(e) => setConversionMode(e.target.value as ConversionMode)}
                className="w-4 h-4 text-blue-600"
              />
              <div>
                <div className="font-medium text-gray-900">⚡ Fast Conversion</div>
                <div className="text-xs text-gray-600">Rule-based, instant, free</div>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="conversionMode"
                value="ai"
                checked={conversionMode === "ai"}
                onChange={(e) => setConversionMode(e.target.value as ConversionMode)}
                className="w-4 h-4 text-purple-600"
              />
              <div>
                <div className="font-medium text-gray-900">🤖 AI-Enhanced</div>
                <div className="text-xs text-gray-600">High quality, preserves formatting</div>
              </div>
            </label>
          </div>

          {conversionMode === "ai" && (
            <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded text-xs text-purple-800">
              <p className="font-medium mb-1">✨ AI-Enhanced Conversion Features:</p>
              <ul className="space-y-1 ml-4">
                <li>• Smart heading hierarchy detection</li>
                <li>• Table conversion to Markdown format</li>
                <li>• Text formatting preservation (bold, italic, code)</li>
                <li>• Improved document structure and spacing</li>
              </ul>
              <p className="mt-2 text-purple-700">
                💡 Requires AI API key configured in Settings
              </p>
            </div>
          )}
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES.join(',')}
            onChange={handleFileSelect}
            className="hidden"
            disabled={conversionStatus === "converting" || isUploading}
          />
          {fileName ? (
            <div>
              {conversionStatus === "converting" && (
                <div className="mb-4">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-sm text-blue-600 mt-2">{conversionMessage}</p>
                </div>
              )}
              {conversionStatus === "success" && (
                <div className="mb-4">
                  <div className="text-4xl mb-2">✅</div>
                  <p className="text-sm text-green-600">{conversionMessage}</p>
                  {conversionMode === "ai" && (
                    <span className="inline-block mt-2 px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                      🤖 AI Enhanced
                    </span>
                  )}
                </div>
              )}
              {conversionStatus === "error" && (
                <div className="mb-4">
                  <div className="text-4xl mb-2">❌</div>
                  <p className="text-sm text-red-600">{conversionMessage}</p>
                </div>
              )}
              <div className="text-4xl mb-2">📄</div>
              <p className="text-sm font-medium text-gray-900">{originalFileName}</p>
              <p className="text-xs text-gray-500 mt-1">
                {content.length} characters • {content.split('\n').length} lines
              </p>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="mt-3 text-sm text-red-600 hover:text-red-700"
              >
                Remove & Choose Different File
              </button>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-2">📁</div>
              <p className="text-gray-600 mb-4">
                Drag and drop a file here, or click to select
              </p>
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {ACCEPTED_FILE_TYPES.map(ext => (
                  <span
                    key={ext}
                    className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
                  >
                    {ext}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={conversionStatus === "converting"}
                className="px-4 py-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                Choose File
              </button>
            </div>
          )}
        </div>
      </div>

      {/* File Details */}
      {conversionStatus === "success" && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">2. Configure File</h2>

          <div className="space-y-4">
            {/* Project Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Project *
              </label>
              <select
                required
                value={formData.projectId}
                onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.team.name} / {project.name}
                  </option>
                ))}
              </select>
            </div>

            {/* File Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Document name"
              />
            </div>

            {/* File Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Document Type
              </label>
              <select
                value={formData.fileType}
                onChange={(e) => setFormData({ ...formData, fileType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="CUSTOM">Custom Document</option>
                <option value="PROBLEM_DEFINITION">Problem Definition</option>
                <option value="SOLUTION_DESIGN">Solution Design</option>
                <option value="EXECUTION_TRACKING">Execution Tracking</option>
                <option value="RETROSPECTIVE_SUMMARY">Retrospective Summary</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {content && conversionStatus === "success" && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">3. Preview Content</h2>
            <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
              Converted to Markdown
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto">
            <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono">
              {content.substring(0, 1000)}
              {content.length > 1000 && "\n\n... (truncated)"}
            </pre>
          </div>
          <div className="mt-2 text-sm text-gray-500">
            <span>{content.length} characters</span>
            <span className="mx-2">•</span>
            <span>{content.split('\n').length} lines</span>
            <span className="mx-2">•</span>
            <span>{content.split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isUploading || !content || !formData.projectId || conversionStatus !== "success"}
          className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? "Importing..." : "Import as Markdown"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
