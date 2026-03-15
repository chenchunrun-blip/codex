"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { TaskDetail } from "@/components/tasks/task-detail"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { ArrowLeft } from "lucide-react"

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  assigneeType: string
  dueDate: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  project: {
    id: string
    name: string
  }
  assignee?: {
    id: string
    name: string | null
    nickname: string | null
    avatar: string | null
  } | null
  agent?: {
    id: string
    name: string
    displayName: string
    type: string
  } | null
  deliverables: Array<{
    id: string
    name: string
    type: string
    status: string
    createdAt: string
  }>
  _count?: {
    deliverables: number
  }
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTask()
  }, [taskId])

  const fetchTask = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/tasks/${taskId}`)

      if (!res.ok) {
        if (res.status === 404) {
          setError("Task not found")
        } else {
          setError("Failed to load task")
        }
        return
      }

      const data = await res.json()
      setTask(data)
    } catch (err) {
      console.error("Failed to fetch task:", err)
      setError("Failed to load task")
    } finally {
      setLoading(false)
    }
  }

  const handleTaskUpdate = () => {
    fetchTask()
  }

  const handleBack = () => {
    router.back()
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !task) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-red-500">{error || "Task not found"}</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Back Button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </button>

        {/* Task Detail */}
        <TaskDetail taskId={task.id} />
      </div>
    </DashboardLayout>
  )
}
