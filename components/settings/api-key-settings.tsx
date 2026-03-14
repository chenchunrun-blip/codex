"use client"

import { useState, useEffect } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export function ApiKeySettings() {
  const [apiKey, setApiKey] = useState("")
  const [aiModel, setAiModel] = useState("gpt-3.5-turbo")
  const [aiEndpoint, setAiEndpoint] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [isSet, setIsSet] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const modelOptions = [
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", provider: "OpenAI" },
    { value: "gpt-4", label: "GPT-4", provider: "OpenAI" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", provider: "OpenAI" },
    { value: "gpt-4o", label: "GPT-4o", provider: "OpenAI" },
    { value: "glm-4", label: "GLM-4", provider: "Zhipu AI" },
    { value: "glm-3-turbo", label: "GLM-3 Turbo", provider: "Zhipu AI" },
    { value: "custom", label: "Custom Model", provider: "Other" },
  ]

  const endpointPresets = [
    { value: "", label: "OpenAI (Default)" },
    { value: "https://open.bigmodel.cn/api/paas/v4", label: "Zhipu AI" },
    { value: "https://api.openai.com/v1", label: "OpenAI" },
  ]

  // Check if API key is already set
  useEffect(() => {
    fetch("/api/user/api-key")
      .then(res => res.json())
      .then(data => {
        if (data.hasApiKey) {
          setIsSet(true)
          setApiKey("••••••••••••••••")
          if (data.aiModel) setAiModel(data.aiModel)
          if (data.aiEndpoint) setAiEndpoint(data.aiEndpoint)
        }
      })
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/user/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          aiModel,
          aiEndpoint: aiEndpoint || undefined
        })
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = mapReportApiErrorFromPayload(data, "Failed to save API configuration")
        setMessage(errorMsg)
      } else {
        setMessage("✅ API configuration saved successfully!")
        setIsSet(true)
        setApiKey("••••••••••••••••")
        setTimeout(() => setMessage(""), 3000)
      }
    } catch (err) {
      console.error('Save error:', err)
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      setMessage(`❌ Failed to save: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    setIsLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/user/api-key", {
        method: "DELETE"
      })
      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setMessage("API key removed successfully!")
        setIsSet(false)
        setApiKey("")
        setTimeout(() => setMessage(""), 3000)
      } else {
        setMessage(mapReportApiErrorFromPayload(data, "Failed to remove API key"))
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to remove API key")
    } finally {
      setIsLoading(false)
    }
  }

  const handleValidate = async () => {
    setIsLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/ai/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      })

      const data = await response.json()

      if (response.ok && data.valid) {
        setMessage("✅ API key is valid!")
      } else if (!response.ok) {
        setMessage(`❌ ${mapReportApiErrorFromPayload(data, "Failed to validate API key")}`)
      } else {
        setMessage("❌ API key is invalid")
      }
    } catch {
      setMessage("Failed to validate API key")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">AI API Key</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure your OpenAI-compatible API key for AI content generation
        </p>
      </div>

      <div className="p-6 space-y-6">
        {message && (
          <div className={`p-3 text-sm rounded ${
            message.includes("successfully") || message.includes("✅")
              ? "text-green-600 bg-green-50 border border-green-200"
              : "text-red-600 bg-red-50 border border-red-200"
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* API Key */}
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-2">
              API Key *
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isSet ? "API key is set" : "sk-..."}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="mt-2 text-xs text-gray-500">
              Your API key is encrypted and stored securely
            </p>
          </div>

          {/* Model Selection */}
          <div>
            <label htmlFor="aiModel" className="block text-sm font-medium text-gray-700 mb-2">
              AI Model *
            </label>
            <select
              id="aiModel"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.provider})
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              Select the AI model you want to use
            </p>
          </div>

          {/* Advanced Settings */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              {showAdvanced ? "▼" : "▶"} Advanced Settings
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 pl-4 border-l-2 border-gray-200">
                {/* API Endpoint Preset */}
                <div>
                  <label htmlFor="endpointPreset" className="block text-sm font-medium text-gray-700 mb-2">
                    API Endpoint Preset
                  </label>
                  <select
                    id="endpointPreset"
                    value={aiEndpoint}
                    onChange={(e) => setAiEndpoint(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    {endpointPresets.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-500">
                    Or use custom endpoint below
                  </p>
                </div>

                {/* Custom Endpoint */}
                <div>
                  <label htmlFor="aiEndpoint" className="block text-sm font-medium text-gray-700 mb-2">
                    Custom API Endpoint
                  </label>
                  <input
                    id="aiEndpoint"
                    type="text"
                    value={aiEndpoint}
                    onChange={(e) => setAiEndpoint(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    For Zhipu AI: https://open.bigmodel.cn/api/paas/v4
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isLoading || !apiKey}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? "Saving..." : "Save Configuration"}
            </button>

            {apiKey && !isSet && (
              <button
                type="button"
                onClick={handleValidate}
                disabled={isLoading}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Validate
              </button>
            )}

            {isSet && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isLoading}
                className="px-4 py-2 text-red-600 bg-white border border-red-300 rounded-lg font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Remove Key
              </button>
            )}
          </div>
        </form>

        {/* API Provider Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Supported AI Providers</h3>
          <ul className="text-xs text-blue-800 space-y-1">
            <li>• OpenAI (GPT-4, GPT-3.5)</li>
            <li>• Azure OpenAI</li>
            <li>• Any OpenAI-compatible API</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
