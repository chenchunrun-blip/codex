"use client"

import { useState, useEffect } from "react"
import { X, Key, Save, RefreshCw } from "lucide-react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Agent {
  id: string
  name: string
  description: string | null
  status: string
  capabilities: string[]
  model: string
  mcpServerUrl: string | null
  systemPrompt: string | null
  createdAt: Date
}

interface AgentConfigPanelProps {
  agentId: string
  onUpdated: () => void
}

export function AgentConfigPanel({ agentId, onUpdated }: AgentConfigPanelProps) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    model: "",
    mcpServerUrl: "",
    systemPrompt: "",
  })

  useEffect(() => {
    fetchAgent()
  }, [agentId])

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

      setFormData({
        name: data.name || "",
        description: data.description || "",
        model: data.model || "",
        mcpServerUrl: data.mcpServerUrl || "",
        systemPrompt: data.systemPrompt || "",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent")
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(data, "Failed to update agent"))
      }

      setSuccess(true)
      onUpdated()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent")
    } finally {
      setSaving(false)
    }
  }

  const regenerateApiKey = async () => {
    if (!confirm("Are you sure? This will invalidate the existing API key.")) {
      return
    }

    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/api/agents/${agentId}/regenerate-key`, {
        method: "POST",
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to regenerate API key"))
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate API key")
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-600">Failed to load agent configuration</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Agent Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure your AI agent settings and capabilities
        </p>
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded">
            Configuration saved successfully
          </div>
        )}

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
            Agent Name
          </label>
          <input
            id="name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
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
            rows={2}
          />
        </div>

        <div>
          <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-2">
            AI Model
          </label>
          <select
            id="model"
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
            <option value="gpt-4-turbo">GPT-4 Turbo</option>
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          </select>
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
            rows={6}
          />
        </div>

        {/* API Key Section */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                API Key
              </label>
              <p className="text-xs text-gray-500">
                Used for external service integrations
              </p>
            </div>
            <button
              type="button"
              onClick={regenerateApiKey}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          </div>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            <Key className="w-4 h-4 text-gray-400" />
            <code className="text-sm text-gray-600 font-mono">
              ••••••••••••••••
            </code>
          </div>
        </div>

        {/* Capabilities */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Capabilities
          </label>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((capability) => (
              <span
                key={capability}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  )
}
