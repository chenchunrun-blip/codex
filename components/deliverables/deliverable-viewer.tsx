"use client"

import { useState } from "react"
import { X, Copy } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { format } from "date-fns"

interface Deliverable {
  id: string
  name: string
  type: string
  status: string
  content: string
  submittedAt: Date | null
  reviewedAt: Date | null
}

interface DeliverableViewerProps {
  isOpen: boolean
  onClose: () => void
  deliverable: Deliverable | null
}

export function DeliverableViewer({ isOpen, onClose, deliverable }: DeliverableViewerProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (deliverable?.content) {
      navigator.clipboard.writeText(deliverable.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!isOpen || !deliverable) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{deliverable.name}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {deliverable.type}
              </span>
              {deliverable.submittedAt && (
                <p className="text-sm text-gray-500">
                  Submitted {format(new Date(deliverable.submittedAt), "PPP")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Copy content"
            >
              <Copy className="w-5 h-5 text-gray-500" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {deliverable.content ? (
            <div className="bg-gray-50 rounded-lg p-6">
              {deliverable.type === "markdown" ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{deliverable.content}</ReactMarkdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                  {deliverable.content}
                </pre>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No content available</p>
            </div>
          )}

          {copied && (
            <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg">
              Copied to clipboard
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
