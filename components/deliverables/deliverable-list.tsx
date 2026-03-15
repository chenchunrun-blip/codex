"use client"

import { useState } from "react"
import { format } from "date-fns"
import { FileText, Clock, CheckCircle, XCircle, Eye } from "lucide-react"
import { DeliverableViewer } from "./deliverable-viewer"
import { DeliverableReviewDialog } from "./deliverable-review-dialog"
import { DeliverableSubmitDialog } from "./deliverable-submit-dialog"

interface Deliverable {
  id: string
  name: string
  type: string
  status: string
  content: string
  submittedAt: Date | null
  reviewedAt: Date | null
  reviewer?: {
    id: string
    name: string | null
    email: string
  } | null
}

interface DeliverableListProps {
  deliverables: Deliverable[]
  taskId: string
  onUpdate: () => void
  canReview?: boolean
}

export function DeliverableList({
  deliverables,
  taskId,
  onUpdate,
  canReview = true
}: DeliverableListProps) {
  const [selectedDeliverable, setSelectedDeliverable] = useState<Deliverable | null>(null)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [reviewingDeliverable, setReviewingDeliverable] = useState<Deliverable | null>(null)
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Clock className="w-4 h-4 text-gray-500" />
      case "SUBMITTED":
        return <FileText className="w-4 h-4 text-blue-500" />
      case "APPROVED":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "REJECTED":
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <FileText className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      PENDING: { bg: "bg-gray-100", text: "text-gray-800", label: "Pending" },
      SUBMITTED: { bg: "bg-blue-100", text: "text-blue-800", label: "Submitted" },
      APPROVED: { bg: "bg-green-100", text: "text-green-800", label: "Approved" },
      REJECTED: { bg: "bg-red-100", text: "text-red-800", label: "Rejected" },
    }
    const config = configs[status] || { bg: "bg-gray-100", text: "text-gray-800", label: status }
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {getStatusIcon(status)}
        {config.label}
      </span>
    )
  }

  const handleView = (deliverable: Deliverable) => {
    setSelectedDeliverable(deliverable)
    setIsViewerOpen(true)
  }

  const handleReview = (deliverable: Deliverable) => {
    setReviewingDeliverable(deliverable)
    setIsReviewDialogOpen(true)
  }

  const handleReviewComplete = () => {
    setIsReviewDialogOpen(false)
    setReviewingDeliverable(null)
    onUpdate()
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setIsSubmitDialogOpen(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Submit Deliverable
        </button>
      </div>
      {deliverables.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <FileText className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-gray-500">No deliverables yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
          {deliverables.map((deliverable) => (
            <div key={deliverable.id} className="p-5 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium text-gray-900">{deliverable.name}</h4>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {deliverable.type}
                    </span>
                    {getStatusBadge(deliverable.status)}
                  </div>
                  {deliverable.content && (
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">{deliverable.content.slice(0, 200)}...</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {deliverable.submittedAt && (
                      <span>
                        Submitted {format(new Date(deliverable.submittedAt), "PPP")}
                      </span>
                    )}
                    {deliverable.reviewedAt && (
                      <span>
                        Reviewed {format(new Date(deliverable.reviewedAt), "PPP")}
                      </span>
                    )}
                    {deliverable.reviewer && (
                      <span>by {deliverable.reviewer.name || deliverable.reviewer.email}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleView(deliverable)}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="View deliverable"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {canReview && deliverable.status === "SUBMITTED" && (
                    <button
                      onClick={() => handleReview(deliverable)}
                      className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DeliverableViewer
        isOpen={isViewerOpen}
        onClose={() => {
          setIsViewerOpen(false)
          setSelectedDeliverable(null)
        }}
        deliverable={selectedDeliverable}
      />

      <DeliverableReviewDialog
        isOpen={isReviewDialogOpen}
        onClose={() => {
          setIsReviewDialogOpen(false)
          setReviewingDeliverable(null)
        }}
        deliverable={reviewingDeliverable}
        onComplete={handleReviewComplete}
      />

      <DeliverableSubmitDialog
        isOpen={isSubmitDialogOpen}
        taskId={taskId}
        onClose={() => setIsSubmitDialogOpen(false)}
        onComplete={() => {
          setIsSubmitDialogOpen(false)
          onUpdate()
        }}
      />
    </>
  )
}
