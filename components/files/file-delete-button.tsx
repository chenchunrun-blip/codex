"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface FileDeleteButtonProps {
  fileId: string
  fileName: string
}

export function FileDeleteButton({ fileId, fileName }: FileDeleteButtonProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setError(null)
    setIsDeleting(true)
    let deleted = false
    try {
      const response = await fetch(`/api/files/${fileId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(payload, "Failed to delete file"))
        return
      }

      // Refresh the page to show updated file list
      deleted = true
      router.refresh()
    } catch (error) {
      console.error("Delete error:", error)
      setError("Failed to delete file")
    } finally {
      setIsDeleting(false)
      if (deleted) {
        setShowConfirm(false)
      }
    }
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        disabled={isDeleting}
        className="text-red-600 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 break-words">
              Delete File
            </h3>
            <p className="text-gray-600 mb-6 break-words">
              Are you sure you want to delete "<span className="font-medium break-all">{fileName}</span>"? This action cannot be undone.
            </p>
            {error && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowConfirm(false)
                  setError(null)
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
