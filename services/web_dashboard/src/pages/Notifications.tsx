/**
 * Notifications Page - In-App Notifications
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Bell, BellRing, Check, CheckCheck, Trash2, Filter } from 'lucide-react'

interface AppNotification {
  id: string
  title: string
  message: string
  type: 'alert' | 'report' | 'system' | 'analysis' | 'workflow'
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  read: boolean
  created_at: string
  link?: string
}

export const Notifications: React.FC = () => {
  const navigate = useNavigate()
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false)
  const queryClient = useQueryClient()

  // Fetch notifications
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', filterUnreadOnly],
    queryFn: async () => {
      const data = await api.notifications.getNotifications(filterUnreadOnly)
      return data as unknown as AppNotification[]
    },
  })

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: string) =>
      api.notifications.markAsRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: () =>
      api.notifications.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (notificationId: string) =>
      api.notifications.delete(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const handleMarkAsRead = (notificationId: string) => {
    if (!notifications.find((n) => n.id === notificationId)?.read) {
      markAsReadMutation.mutate(notificationId)
    }
  }

  const handleNotificationClick = (notification: AppNotification) => {
    // Mark as read first
    handleMarkAsRead(notification.id)

    // Then navigate if link exists
    if (notification.link) {
      navigate(notification.link)
    }
  }

  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate()
  }

  const handleDelete = (notificationId: string) => {
    if (confirm('Are you sure you want to delete this notification?')) {
      deleteMutation.mutate(notificationId)
    }
  }

  const getSeverityColor = (severity: string) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300',
      info: 'bg-gray-100 text-gray-800 border-gray-300',
    }
    return colors[severity as keyof typeof colors] || colors.info
  }

  const getTypeIcon = (type: string) => {
    const icons = {
      alert: '🚨',
      report: '📊',
      system: '⚙️',
      analysis: '🧠',
      workflow: '⚡',
    }
    return icons[type as keyof typeof icons] || '📌'
  }

  const unreadCount = notifications.filter((n: AppNotification) => !n.read).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <BellRing className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            <p className="text-sm text-gray-600">
              In-App Notifications • {unreadCount} unread
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFilterUnreadOnly(!filterUnreadOnly)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              filterUnreadOnly
                ? 'bg-primary-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            {filterUnreadOnly ? 'Show All' : 'Unread Only'}
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={markAllAsReadMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCheck className="w-4 h-4" />
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="spinner"></div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center bg-white rounded-lg border border-gray-200">
          <Bell className="w-16 h-16 text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Notifications</h3>
          <p className="text-sm text-gray-500">
            {filterUnreadOnly ? 'Great! You have read all notifications' : 'No notifications yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification: AppNotification) => (
            <div
              key={notification.id}
              className={`bg-white rounded-lg border transition-all hover:shadow-md cursor-pointer ${
                !notification.read ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'
              }`}
              onClick={(e) => {
                // Don't trigger if clicked on action buttons
                if ((e.target as HTMLElement).closest('button')) return
                handleNotificationClick(notification)
              }}
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="flex-shrink-0 text-3xl">
                    {getTypeIcon(notification.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {!notification.read && (
                            <span className="w-2 h-2 bg-primary-600 rounded-full"></span>
                          )}
                          <h3 className={`text-lg font-semibold ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
                            {notification.title}
                          </h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getSeverityColor(notification.severity)}`}>
                            {notification.severity.toUpperCase()}
                          </span>
                        </div>
                        <p className={`text-sm mb-2 ${!notification.read ? 'text-gray-700' : 'text-gray-500'}`}>
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(notification.created_at).toLocaleString('en-US')}
                        </p>
                        {notification.link && (
                          <p className="text-xs text-primary-600 mt-2">
                            Click to view details →
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {!notification.read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMarkAsRead(notification.id)
                            }}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Mark as read"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(notification.id)
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
