"use client"

import { formatDistanceToNow } from "date-fns"
import Link from "next/link"
import { Calendar, User, MessageSquare } from "lucide-react"
import { TaskStatusBadge, TaskPriorityBadge } from "./task-status-badge"

type AssignmentBadge = {
  label: string
  className: string
}

function formatAssignmentMode(value: string): string {
  if (value === "AI_SUGGESTED") return "AI Suggested"
  if (value === "AI_AUTO") return "AI Auto"
  return "Manual"
}

function formatAssigneeType(value: string): string {
  if (value === "FUNCTIONAL_AGENT") return "Agent Queue"
  if (value === "AGENT") return "Agent"
  return "Human"
}

export function getAssignmentBadges(task: {
  assignmentMode?: string
  functionalAgentType?: string | null
  assigneeType?: string
}): AssignmentBadge[] {
  const badges: AssignmentBadge[] = []

  if (task.assignmentMode) {
    badges.push({
      label: formatAssignmentMode(task.assignmentMode),
      className: "bg-gray-100 text-gray-700"
    })
  }

  if (task.functionalAgentType) {
    badges.push({
      label: `QUEUE:${task.functionalAgentType}`,
      className: "bg-blue-100 text-blue-700"
    })
  }

  if (task.assigneeType) {
    badges.push({
      label: `Assignee:${formatAssigneeType(task.assigneeType)}`,
      className: "bg-purple-100 text-purple-700"
    })
  }

  return badges
}

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  assignmentMode?: string
  functionalAgentType?: string | null
  assigneeType?: string
  dueDate: Date | null
  createdAt: Date
  project: {
    id: string
    name: string
  } | null
  assignee: {
    id: string
    name: string | null
    email: string
    avatar: string | null
  } | null
  agent?: {
    id: string
    name: string
  } | null
  deliverables: Array<{
    id: string
    status: string
  }>
  latestAgentRun?: {
    status: "SUCCESS" | "FAILED"
    triggeredAt: string
    executionId: string | null
    error: string | null
  } | null
  specQualityScore?: number | null
  riskScore?: number
  riskLevel?: "LOW" | "MEDIUM" | "HIGH"
  riskReasons?: string[]
}

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const pendingDeliverables = (task.deliverables || []).filter(d => d.status !== "APPROVED").length
  const assignmentBadges = getAssignmentBadges(task)

  // Convert numeric priority to string for badge
  const priorityLabel = task.priority === 3 ? "URGENT" : task.priority === 2 ? "HIGH" : task.priority === 1 ? "MEDIUM" : "LOW"

  // Get assigned entity (user or agent)
  const assignedEntity = task.assignee || task.agent

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <TaskStatusBadge status={task.status} />
            <TaskPriorityBadge priority={priorityLabel} />
          </div>
          {assignmentBadges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {assignmentBadges.map((badge) => (
                <span
                  key={badge.label}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
          {task.latestAgentRun && (
            <div className="mb-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                  task.latestAgentRun.status === "SUCCESS"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                Last Run: {task.latestAgentRun.status}
              </span>
            </div>
          )}
          {typeof task.specQualityScore === "number" && (
            <div className="mb-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                  task.specQualityScore >= 80
                    ? "bg-green-100 text-green-700"
                    : task.specQualityScore >= 60
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                Spec: {task.specQualityScore}/100
              </span>
            </div>
          )}
          {typeof task.riskScore === "number" && (
            <div className="mb-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                  task.riskLevel === "HIGH"
                    ? "bg-red-100 text-red-700"
                    : task.riskLevel === "MEDIUM"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
                title={Array.isArray(task.riskReasons) ? task.riskReasons.join("; ") : undefined}
              >
                Risk: {task.riskLevel || "LOW"} ({task.riskScore})
              </span>
            </div>
          )}
          <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">{task.title}</h3>
          {task.description && (
            <p className="text-sm text-gray-600 line-clamp-2 mb-3">{task.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            {task.project && (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                {task.project.name}
              </span>
            )}
            {task.dueDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}
              </span>
            )}
            {pendingDeliverables > 0 && (
              <span className="text-orange-600">
                {pendingDeliverables} deliverable{pendingDeliverables > 1 ? "s" : ""} pending
              </span>
            )}
          </div>
        </div>

        {assignedEntity ? (
          <div className="flex-shrink-0 text-right">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ml-auto ${task.agent ? "bg-purple-600" : "bg-blue-600"}`}>
              {task.agent
                ? "🤖"
                : (task.assignee!.name || task.assignee!.email || "U").charAt(0).toUpperCase()
              }
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-[80px] truncate">
              {task.agent?.name || (task.assignee?.name || task.assignee?.email || "Assigned")}
            </p>
          </div>
        ) : (
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
              <User className="w-5 h-5" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Unassigned</p>
          </div>
        )}
      </div>
    </Link>
  )
}
