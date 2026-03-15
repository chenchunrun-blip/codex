"use client"

import { Bot, Settings, Edit, Eye, Trash2 } from "lucide-react"

interface Agent {
  id: string
  name: string
  displayName: string
  description: string | null
  type: string
  capabilities: string[] | null
  lastActiveAt: Date | null
  isOnline?: boolean
  isActive?: boolean
  _count?: {
    tasks: number
  }
  workload?: {
    activeTasks: number
  }
  recentRuns?: {
    failed: number
    success: number
  }
  queuePressure?: {
    backlog: number
  }
}

interface AgentCardProps {
  agent: Agent
  onView?: (agentId: string) => void
  onEdit?: (agentId: string) => void
  onDelete?: (agentId: string) => void
  showActions?: boolean
}

export function AgentCard({ agent, onView, onEdit, onDelete, showActions = true }: AgentCardProps) {
  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : []

  const capabilityColors: Record<string, string> = {
    "text-generation": "bg-blue-100 text-blue-800",
    "code-generation": "bg-purple-100 text-purple-800",
    "analysis": "bg-green-100 text-green-800",
    "web-search": "bg-yellow-100 text-yellow-800",
    "file-operations": "bg-orange-100 text-orange-800",
    "task-management": "bg-pink-100 text-pink-800",
    "collaboration": "bg-cyan-100 text-cyan-800",
  }

  const activeTime =
    agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString() : "Never active"

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onView?.(agent.id)}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${agent.isActive === false ? 'bg-gray-400' : 'bg-purple-600'}`}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{agent.displayName || agent.name}</h3>
                {agent.isActive === false && (
                  <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                    Inactive
                  </span>
                )}
                {agent.isActive !== false && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      agent.isOnline ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}
                    title={`Last active: ${activeTime}`}
                  >
                    {agent.isOnline ? "Online" : "Idle"}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">{agent.type} Agent</p>
            </div>
          </div>

          {agent.description && (
            <p className="text-sm text-gray-600 mb-3 line-clamp-2">{agent.description}</p>
          )}

          {capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {capabilities.slice(0, 3).map((capability) => (
                <span
                  key={capability}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    capabilityColors[capability] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {capability}
                </span>
              ))}
              {capabilities.length > 3 && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                  +{capabilities.length - 3}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-500">
            {agent._count !== undefined && (
              <span>{agent._count.tasks} tasks</span>
            )}
            {agent.workload && (
              <span>active {agent.workload.activeTasks}</span>
            )}
            {agent.recentRuns && (
              <span className={agent.recentRuns.failed > 0 ? "text-red-600" : "text-green-600"}>
                runs {agent.recentRuns.success}/{agent.recentRuns.failed}
              </span>
            )}
            {agent.queuePressure && (
              <span>queue {agent.queuePressure.backlog}</span>
            )}
            {agent.lastActiveAt && (
              <span>Last active {new Date(agent.lastActiveAt).toLocaleString()}</span>
            )}
          </div>
        </div>

        {showActions && (
          <div className="flex flex-col gap-1">
            {onView && (
              <button
                onClick={() => onView(agent.id)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                title="View details"
              >
                <Eye className="w-4 h-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(agent.id)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                title="Edit agent"
              >
                <Edit className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(agent.id)}
                className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                title="Delete agent"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
