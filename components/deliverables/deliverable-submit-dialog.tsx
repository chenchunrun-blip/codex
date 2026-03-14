"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface DeliverableSubmitDialogProps {
  isOpen: boolean
  taskId: string
  onClose: () => void
  onComplete: () => void
}

export function DeliverableSubmitDialog({
  isOpen,
  taskId,
  onClose,
  onComplete
}: DeliverableSubmitDialogProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState("markdown")
  const [content, setContent] = useState("")
  const [createFile, setCreateFile] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const reset = () => {
    setName("")
    setType("markdown")
    setContent("")
    setCreateFile(false)
    setError("")
  }

  const handleClose = () => {
    if (loading) return
    reset()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !content.trim()) {
      setError("Name and content are required.")
      return
    }

    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          name: name.trim(),
          type: type.trim() || "markdown",
          content: content.trim(),
          createFile
        })
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(mapTaskApiErrorFromPayload(payload, "Failed to submit deliverable"))
      }
      reset()
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit deliverable")
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Submit Deliverable</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Implementation summary"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="markdown"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="# Deliverable

- What was completed
- Evidence
- Notes"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              required
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={createFile}
              onChange={(e) => setCreateFile(e.target.checked)}
              disabled={loading}
            />
            Also create a project file from this deliverable
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
