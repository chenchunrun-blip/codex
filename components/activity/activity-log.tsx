"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Activity {
  id: string
  action: string
  details?: string | null
  createdAt: Date
  user: {
    id: string
    name: string | null
    email: string
  }
  file?: {
    id: string
    name: string
  } | null
  project: {
    id: string
    name: string
  }
}

interface ActivityLogProps {
  projectId?: string
  fileId?: string
  limit?: number
}

export function ActivityLog({ projectId, fileId, limit = 20 }: ActivityLogProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchActivities()
    // Refresh every 30 seconds
    const interval = setInterval(fetchActivities, 30000)
    return () => clearInterval(interval)
  }, [projectId, fileId, limit])

  const fetchActivities = async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (projectId) params.set('projectId', projectId)
      if (fileId) params.set('fileId', fileId)
      params.set('limit', limit.toString())

      const response = await fetch(`/api/activity?${params}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch activities"))
      }

      const data = await response.json()
      setActivities(data.activities || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities')
    } finally {
      setLoading(false)
    }
  }

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      FILE_CREATED: '📄 Created file',
      FILE_UPDATED: '✏️ Updated file',
      FILE_DELETED: '🗑️ Deleted file',
      COMMENT_ADDED: '💬 Added comment',
      COMMENT_UPDATED: '📝 Updated comment',
      COMMENT_DELETED: '🗑️ Deleted comment',
      MEMBER_ADDED: '➕ Added member',
      MEMBER_REMOVED: '➖ Removed member',
      MEMBER_ROLE_UPDATED: '🔄 Updated member role',
      PROJECT_CREATED: '📁 Created project',
      PROJECT_UPDATED: '⚙️ Updated project',
      PROJECT_DELETED: '🗑️ Deleted project'
    }
    return labels[action] || action
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center text-red-600">
          <p className="font-medium">Failed to load activity log</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={fetchActivities}
            className="mt-3 text-sm text-blue-600 hover:text-blue-700 underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center text-gray-500 py-8">
          <p className="text-4xl mb-2">📋</p>
          <p>No activity yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">Activity Log</h3>
      </div>
      <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
        {activities.map((activity) => (
          <div key={activity.id} className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                {(activity.user.name || activity.user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {activity.user.name || activity.user.email}
                  </span>
                  <span className="text-gray-300 flex-shrink-0">•</span>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {formatTime(activity.createdAt)}
                  </span>
                </div>
                <div className="text-sm text-gray-700 break-words">
                  {getActionLabel(activity.action)}
                  {activity.file && (
                    <span className="ml-1 text-blue-600 hover:text-blue-700 cursor-pointer break-all">
                      "{activity.file.name}"
                    </span>
                  )}
                </div>
                {activity.details && (
                  <p className="text-xs text-gray-500 mt-1 break-words">{activity.details}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
