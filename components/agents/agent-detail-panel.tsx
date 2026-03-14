"use client"

import { useState, useEffect } from "react"
import { X, Bot, Calendar, FileText, ExternalLink, Edit } from "lucide-react"
import Link from "next/link"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Task {
  id: string
  title: string
  status: string
  projectId: string
  project: {
    name: string
  }
  createdAt: string
}

interface Agent {
  id: string
  name: string
  displayName: string
  description: string | null
  type: string
  capabilities: string[] | null
  apiEndpoint: string | null
  modelConfig: { model?: string } | null
  systemPrompt: string | null
  isActive: boolean
  isOnline?: boolean
  lastActiveAt?: string | null
  diagnostics?: {
    taskStatus: {
      pending: number
      inProgress: number
      review: number
      completed: number
      cancelled: number
    }
    recentRuns: {
      success: number
      failed: number
      lastRunAt: string | null
      lastRunStatus: "SUCCESS" | "FAILED" | null
    }
    queuePressure: {
      domains: string[]
      backlog: number
    }
  }
  tasks: Task[]
  _count: {
    tasks: number
  }
}

interface AgentDetailPanelProps {
  isOpen: boolean
  agentId: string | null
  onClose: () => void
  onEdit: (agentId: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-800",
}

export function AgentDetailPanel({ isOpen, agentId, onClose, onEdit }: AgentDetailPanelProps) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && agentId) {
      fetchAgent()
    }
  }, [isOpen, agentId])

  const fetchAgent = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/agents/${agentId}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch agent"))
      }
      const data = await response.json()
      setAgent(data)
    } catch (err) {
      console.error("Failed to fetch agent:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch agent")
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !agentId) return null

  const capabilities = Array.isArray(agent?.capabilities) ? agent.capabilities : []

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-600">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {loading ? "Loading..." : agent?.displayName || agent?.name}
              </h2>
              <p className="text-sm text-gray-500">{agent?.type} Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agent && (
              <button
                onClick={() => onEdit(agent.id)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Edit agent"
              >
                <Edit className="w-5 h-5 text-gray-500" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : agent ? (
            <div className="space-y-6">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    agent.isActive
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {agent.isActive ? "Active" : "Inactive"}
                </span>
                {agent.isActive && (
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      agent.isOnline ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {agent.isOnline ? "Online" : "Idle"}
                  </span>
                )}
                {(agent.modelConfig as any)?.model && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                    {(agent.modelConfig as any).model}
                  </span>
                )}
                {agent.lastActiveAt && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                    Last active {new Date(agent.lastActiveAt).toLocaleString()}
                  </span>
                )}
              </div>

              {/* Description */}
              {agent.description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
                  <p className="text-gray-900">{agent.description}</p>
                </div>
              )}

              {agent.diagnostics && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded border border-gray-200 p-3">
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">Task Status</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div>Pending: {agent.diagnostics.taskStatus.pending}</div>
                      <div>In Progress: {agent.diagnostics.taskStatus.inProgress}</div>
                      <div>Review: {agent.diagnostics.taskStatus.review}</div>
                      <div>Completed: {agent.diagnostics.taskStatus.completed}</div>
                    </div>
                  </div>
                  <div className="rounded border border-gray-200 p-3">
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">Recent Runs</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div>Success: {agent.diagnostics.recentRuns.success}</div>
                      <div>Failed: {agent.diagnostics.recentRuns.failed}</div>
                      <div>
                        Last: {agent.diagnostics.recentRuns.lastRunStatus || "N/A"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-gray-200 p-3">
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">Queue Pressure</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div>Backlog: {agent.diagnostics.queuePressure.backlog}</div>
                      <div>
                        Domains:{" "}
                        {agent.diagnostics.queuePressure.domains.length > 0
                          ? agent.diagnostics.queuePressure.domains.join(", ")
                          : "N/A"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Capabilities */}
              {capabilities.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Capabilities</h3>
                  <div className="flex flex-wrap gap-2">
                    {capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* MCP Endpoint */}
              {agent.apiEndpoint && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">MCP Server URL</h3>
                  <code className="block p-2 bg-gray-100 rounded text-sm text-gray-900 break-all">
                    {agent.apiEndpoint}
                  </code>
                </div>
              )}

              {/* System Prompt */}
              {agent.systemPrompt && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">System Prompt</h3>
                  <pre className="p-3 bg-gray-100 rounded text-sm text-gray-900 whitespace-pre-wrap overflow-auto max-h-40">
                    {agent.systemPrompt}
                  </pre>
                </div>
              )}

              {/* Assigned Tasks */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700">
                    Assigned Tasks ({agent._count.tasks})
                  </h3>
                </div>

                {agent.tasks.length === 0 ? (
                  <div className="p-4 bg-gray-50 rounded-lg text-center text-gray-500 text-sm">
                    No tasks assigned to this agent
                  </div>
                ) : (
                  <div className="space-y-2">
                    {agent.tasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{task.title}</p>
                            <p className="text-xs text-gray-500">{task.project.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              STATUS_COLORS[task.status] || "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {task.status.replace("_", " ")}
                          </span>
                          <ExternalLink className="w-4 h-4 text-gray-400" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              {error || "Failed to load agent details"}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
