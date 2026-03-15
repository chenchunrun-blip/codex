"use client"

interface TaskStatusBadgeProps {
  status: string
  className?: string
}

export function TaskStatusBadge({ status, className = "" }: TaskStatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      PENDING: { bg: "bg-gray-100", text: "text-gray-800", label: "Pending" },
      IN_PROGRESS: { bg: "bg-blue-100", text: "text-blue-800", label: "In Progress" },
      IN_REVIEW: { bg: "bg-yellow-100", text: "text-yellow-800", label: "In Review" },
      COMPLETED: { bg: "bg-green-100", text: "text-green-800", label: "Completed" },
      CANCELLED: { bg: "bg-red-100", text: "text-red-800", label: "Cancelled" },
      BLOCKED: { bg: "bg-red-100", text: "text-red-800", label: "Blocked" },
    }
    return configs[status] || { bg: "bg-gray-100", text: "text-gray-800", label: status }
  }

  const config = getStatusConfig(status)

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text} ${className}`}>
      {config.label}
    </span>
  )
}

export function TaskPriorityBadge({ priority }: { priority: string }) {
  const getPriorityConfig = (priority: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      LOW: { bg: "bg-gray-100", text: "text-gray-800", label: "Low" },
      MEDIUM: { bg: "bg-blue-100", text: "text-blue-800", label: "Medium" },
      HIGH: { bg: "bg-orange-100", text: "text-orange-800", label: "High" },
      URGENT: { bg: "bg-red-100", text: "text-red-800", label: "Urgent" },
    }
    return configs[priority] || { bg: "bg-gray-100", text: "text-gray-800", label: priority }
  }

  const config = getPriorityConfig(priority)

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  )
}
