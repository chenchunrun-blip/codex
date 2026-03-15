"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface CreateTaskFromFileButtonProps {
  fileId: string
  fileName: string
}

export function CreateTaskFromFileButton({ fileId, fileName }: CreateTaskFromFileButtonProps) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateTask = async () => {
    setError(null)
    const suggestedTitle = `Task from ${fileName.replace(/\.md$/i, "")}`
    const title = window.prompt("Task title", suggestedTitle)
    if (title === null) return
    const trimmedTitle = title.trim()
    if (trimmedTitle.length < 2) {
      setError("Task title must be at least 2 characters.")
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch(`/api/files/${fileId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(mapTaskApiErrorFromPayload(data, "Failed to create task from file"))
        return
      }

      if (data?.task?.id) {
        router.push(`/tasks/${data.task.id}`)
        return
      }
      router.refresh()
    } catch (error) {
      console.error("Create task from file error:", error)
      setError("Failed to create task from file")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCreateTask}
        disabled={isCreating}
        className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Create task from this markdown file"
      >
        {isCreating ? "Creating..." : "Create Task"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
