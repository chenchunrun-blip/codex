"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface BulkCreateTasksButtonProps {
  fileIds: string[]
}

export function BulkCreateTasksButton({ fileIds }: BulkCreateTasksButtonProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const canRun = fileIds.length > 0

  const runBulkCreate = async () => {
    if (!canRun || isSubmitting) return
    setIsSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch("/api/files/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds,
          skipIfLinkedTaskExists: true
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapTaskApiErrorFromPayload(payload, "Bulk create failed"))
      }
      setMessage(
        `Created ${payload.createdCount || 0} task(s), skipped ${payload.skippedCount || 0}.`
      )
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk create failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={runBulkCreate}
        disabled={!canRun || isSubmitting}
        className="px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {isSubmitting ? "Creating..." : `Bulk Create Tasks (${fileIds.length})`}
      </button>
      {message && <div className="text-xs text-gray-600">{message}</div>}
    </div>
  )
}
