"use client"

import { useState, useEffect } from "react"
import { X, User, Bot } from "lucide-react"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface User {
  id: string
  name: string | null
  email: string
  avatar: string | null
}

interface Agent {
  id: string
  name: string
  displayName: string
  isActive: boolean
}

interface TaskAssignDialogProps {
  isOpen: boolean
  onClose: () => void
  taskId: string
  projectId?: string
  onAssigned: () => void
}

type AssigneeType = "user" | "agent" | "agent-queue"
type AgentQueueType = "PRODUCT" | "ENGINEERING" | "QA" | "DESIGN" | "OPERATIONS"

export function TaskAssignDialog({ isOpen, onClose, taskId, projectId, onAssigned }: TaskAssignDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [assigneeType, setAssigneeType] = useState<AssigneeType>("user")
  const [agentQueueType, setAgentQueueType] = useState<AgentQueueType>("ENGINEERING")
  const [users, setUsers] = useState<User[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState("")

  useEffect(() => {
    if (isOpen) {
      fetchUsers()
      fetchAgents()
    }
  }, [isOpen])

  const fetchUsers = async () => {
    try {
      const url = projectId ? `/api/users?projectId=${projectId}` : "/api/users"
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setUsers(data)
      }
    } catch (err) {
      console.error("Failed to load users:", err)
    }
  }

  const fetchAgents = async () => {
    try {
      const response = await fetch("/api/agents")
      if (response.ok) {
        const data = await response.json()
        setAgents(data.agents || [])
      }
    } catch (err) {
      console.error("Failed to load agents:", err)
    }
  }

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (assigneeType !== "agent-queue" && !selectedId) return

    setError("")
    setIsLoading(true)

    try {
      const body = assigneeType === "user"
        ? {
            assigneeType: "HUMAN",
            assigneeId: selectedId,
            assignmentMode: "MANUAL",
            source: "manual"
          }
        : assigneeType === "agent"
          ? {
              assigneeType: "AGENT",
              agentId: selectedId,
              assignmentMode: "MANUAL",
              source: "manual"
            }
          : {
              assigneeType: "FUNCTIONAL_AGENT",
              functionalAgentType: agentQueueType,
              agentId: selectedId || null,
              assignmentMode: "MANUAL",
              source: "manual"
            }

      const response = await fetch(`/api/tasks/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(mapTaskApiErrorFromPayload(data, "Failed to assign task"))
      } else {
        onAssigned()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign task")
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnassign = async () => {
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch(`/api/tasks/${taskId}/unassign`, {
        method: "POST",
      })

      if (!response.ok) {
        const data = await response.json()
        setError(mapTaskApiErrorFromPayload(data, "Failed to unassign task"))
      } else {
        onAssigned()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign task")
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Assign Task</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleAssign} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Assign to
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAssigneeType("user")}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                  assigneeType === "user"
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <User className="w-4 h-4" />
                Human
              </button>
              <button
                type="button"
                onClick={() => setAssigneeType("agent")}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                  assigneeType === "agent"
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Bot className="w-4 h-4" />
                Agent
              </button>
              <button
                type="button"
                onClick={() => setAssigneeType("agent-queue")}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                  assigneeType === "agent-queue"
                    ? "bg-blue-50 border-blue-500 text-blue-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Bot className="w-4 h-4" />
                Agent Queue
              </button>
            </div>
          </div>

          {assigneeType === "agent-queue" && (
            <div>
              <label htmlFor="functional-type" className="block text-sm font-medium text-gray-700 mb-2">
                Agent Domain
              </label>
              <select
                id="functional-type"
                value={agentQueueType}
                onChange={(e) => setAgentQueueType(e.target.value as AgentQueueType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="PRODUCT">Product</option>
                <option value="ENGINEERING">Engineering</option>
                <option value="QA">QA</option>
                <option value="DESIGN">Design</option>
                <option value="OPERATIONS">Operations</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="assignee" className="block text-sm font-medium text-gray-700 mb-2">
              {assigneeType === "user"
                ? "Select Human"
                : assigneeType === "agent"
                  ? "Select Agent"
                  : "Optional Concrete Agent"}
            </label>
            <select
              id="assignee"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={assigneeType !== "agent-queue"}
            >
              <option value="">
                {assigneeType === "user"
                  ? "Select a human"
                  : assigneeType === "agent"
                    ? "Select an agent"
                    : "No concrete agent (queue only)"}
              </option>
              {assigneeType === "user"
                ? users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name || user.email}
                    </option>
                  ))
                : agents
                    .filter((a) => a.isActive)
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.displayName || agent.name}
                      </option>
                    ))}
            </select>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={handleUnassign}
              className="px-4 py-2 text-red-600 hover:text-red-700 text-sm font-medium"
              disabled={isLoading}
            >
              Unassign
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || (assigneeType !== "agent-queue" && !selectedId)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Assigning..." : "Assign"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
