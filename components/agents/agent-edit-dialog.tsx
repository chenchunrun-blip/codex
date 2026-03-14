"use client"

import { useState, useEffect } from "react"
import { X, Trash2 } from "lucide-react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Agent {
  id: string
  name: string
  displayName: string
  description: string | null
  type: string
  capabilities: string[] | null
  apiEndpoint: string | null
  modelConfig: { model?: string; temperature?: number; maxTokens?: number } | null
  systemPrompt: string | null
  isActive: boolean
}

interface AgentEditDialogProps {
  isOpen: boolean
  agentId: string | null
  onClose: () => void
  onUpdated: () => void
  onDeleted: () => void
}

const AVAILABLE_CAPABILITIES = [
  { id: "text-generation", label: "Text Generation" },
  { id: "code-generation", label: "Code Generation" },
  { id: "analysis", label: "Analysis" },
  { id: "web-search", label: "Web Search" },
  { id: "file-operations", label: "File Operations" },
  { id: "task-management", label: "Task Management" },
  { id: "collaboration", label: "Collaboration" },
]

const AVAILABLE_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
]

export function AgentEditDialog({ isOpen, agentId, onClose, onUpdated, onDeleted }: AgentEditDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState("")
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([])

  const [formData, setFormData] = useState({
    displayName: "",
    description: "",
    model: "claude-opus-4-6",
    mcpServerUrl: "",
    apiKey: "",
    systemPrompt: "",
    isActive: true,
  })

  useEffect(() => {
    if (isOpen && agentId) {
      fetchAgent()
    }
  }, [isOpen, agentId])

  const fetchAgent = async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch agent"))
      }

      const agent: Agent = await response.json()
      const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : []

      setFormData({
        displayName: agent.displayName || "",
        description: agent.description || "",
        model: (agent.modelConfig as any)?.model || "claude-opus-4-6",
        mcpServerUrl: agent.apiEndpoint || "",
        apiKey: "",
        systemPrompt: agent.systemPrompt || "",
        isActive: agent.isActive,
      })
      setSelectedCapabilities(capabilities)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent details")
    }
  }

  const toggleCapability = (capability: string) => {
    setSelectedCapabilities((prev) =>
      prev.includes(capability)
        ? prev.filter((c) => c !== capability)
        : [...prev, capability]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: formData.displayName,
          description: formData.description,
          capabilities: selectedCapabilities,
          apiEndpoint: formData.mcpServerUrl || null,
          modelConfig: {
            model: formData.model,
          },
          systemPrompt: formData.systemPrompt,
          isActive: formData.isActive,
          apiKey: formData.apiKey || undefined,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(mapReportApiErrorFromPayload(data, "Failed to update agent"))
      } else {
        onUpdated()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this agent? This action cannot be undone.")) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(mapReportApiErrorFromPayload(data, "Failed to delete agent"))
      } else {
        onDeleted()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent")
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isOpen || !agentId) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Edit Agent</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
              Display Name *
            </label>
            <input
              id="displayName"
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Code Review Agent"
              required
              minLength={2}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What does this agent do?"
              rows={2}
            />
          </div>

          <div>
            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-2">
              AI Model *
            </label>
            <select
              id="model"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Capabilities
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_CAPABILITIES.map((capability) => (
                <button
                  key={capability.id}
                  type="button"
                  onClick={() => toggleCapability(capability.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedCapabilities.includes(capability.id)
                      ? "bg-blue-100 text-blue-700 border-2 border-blue-500"
                      : "bg-gray-100 text-gray-700 border-2 border-transparent hover:bg-gray-200"
                  }`}
                >
                  {capability.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="mcpServerUrl" className="block text-sm font-medium text-gray-700 mb-2">
              MCP Server URL
            </label>
            <input
              id="mcpServerUrl"
              type="url"
              value={formData.mcpServerUrl}
              onChange={(e) => setFormData({ ...formData, mcpServerUrl: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://your-mcp-server.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional: URL to the MCP server for this agent
            </p>
          </div>

          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Leave empty to keep existing key"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to keep the existing API key
            </p>
          </div>

          <div>
            <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-700 mb-2">
              System Prompt
            </label>
            <textarea
              id="systemPrompt"
              value={formData.systemPrompt}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="You are a helpful AI agent..."
              rows={4}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isActive"
              type="checkbox"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Agent is active
            </label>
          </div>

          <div className="flex justify-between gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {isDeleting ? "Deleting..." : "Delete"}
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
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
