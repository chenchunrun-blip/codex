"use client"

import { useState } from "react"
import { X, CheckCircle, XCircle } from "lucide-react"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface Deliverable {
  id: string
  name: string
  type: string
  status: string
  content: string
}

interface DeliverableReviewDialogProps {
  isOpen: boolean
  onClose: () => void
  deliverable: Deliverable | null
  onComplete: () => void
}

type ReviewDecision = "approve" | "reject" | null

export function DeliverableReviewDialog({
  isOpen,
  onClose,
  deliverable,
  onComplete
}: DeliverableReviewDialogProps) {
  const [decision, setDecision] = useState<ReviewDecision>(null)
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!decision || !deliverable) return

    setError("")
    setLoading(true)

    try {
      const response = await fetch(`/api/deliverables/${deliverable.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: decision === "approve" ? "APPROVED" : "REJECTED",
          feedback: decision === "reject" ? feedback : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to submit review"))
      }

      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review")
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setDecision(null)
    setFeedback("")
    setError("")
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  if (!isOpen || !deliverable) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Review Deliverable</h2>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-gray-900">{deliverable.name}</p>
              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                {deliverable.type}
              </span>
            </div>
            {deliverable.content && (
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{deliverable.content.slice(0, 150)}...</p>
            )}
          </div>

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Your Decision
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDecision("approve")}
                disabled={loading}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors flex items-center justify-center gap-2 ${
                  decision === "approve"
                    ? "bg-green-50 border-green-500 text-green-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => setDecision("reject")}
                disabled={loading}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-colors flex items-center justify-center gap-2 ${
                  decision === "reject"
                    ? "bg-red-50 border-red-500 text-red-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <XCircle className="w-5 h-5" />
                Reject
              </button>
            </div>
          </div>

          {decision === "reject" && (
            <div>
              <label htmlFor="feedback" className="block text-sm font-medium text-gray-700 mb-2">
                Feedback (required for rejection)
              </label>
              <textarea
                id="feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Explain why this deliverable was rejected and what needs to be changed..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                required
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!decision || loading || (decision === "reject" && !feedback.trim())}
              className={`px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${
                decision === "approve"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {loading ? "Submitting..." : decision === "approve" ? "Approve" : "Reject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
