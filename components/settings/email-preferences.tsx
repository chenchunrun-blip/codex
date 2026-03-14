"use client"

import { useState, useEffect } from "react"

interface EmailPreferencesProps {
  emailEnabled: boolean
}

interface EmailPreferenceType {
  key: string
  label: string
  description: string
  icon: string
}

const emailTypes: EmailPreferenceType[] = [
  {
    key: "mentions",
    label: "@Mentions",
    description: "When someone mentions you in a comment",
    icon: "💬"
  },
  {
    key: "teamInvites",
    label: "Team Invitations",
    description: "When someone adds you to a team",
    icon: "👥"
  },
  {
    key: "projectInvites",
    label: "Project Invitations",
    description: "When someone adds you to a project",
    icon: "📁"
  },
  {
    key: "fileUpdates",
    label: "File Updates",
    description: "When files are updated in your projects",
    icon: "📄"
  },
  {
    key: "projectUpdates",
    label: "Project Updates",
    description: "When project information changes",
    icon: "⚙️"
  }
]

export function EmailPreferences({ emailEnabled }: EmailPreferencesProps) {
  const [isEnabled, setIsEnabled] = useState(emailEnabled)
  const [preferences, setPreferences] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("")

  // Load saved preferences
  useEffect(() => {
    const saved = localStorage.getItem('emailPreferences')
    if (saved) {
      setPreferences(JSON.parse(saved))
    } else {
      // Default all to enabled
      const defaults = emailTypes.reduce((acc, type) => ({ ...acc, [type.key]: true }), {})
      setPreferences(defaults)
    }
  }, [])

  const handleToggleEnabled = async () => {
    setIsLoading(true)
    setMessage("")

    try {
      const newValue = !isEnabled
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailEnabled: newValue })
      })

      if (response.ok) {
        setIsEnabled(newValue)
        setMessage(newValue ? "Email notifications enabled" : "Email notifications disabled")
      } else {
        setMessage("Failed to update email settings")
      }
    } catch (error) {
      setMessage("Failed to update email settings")
    } finally {
      setIsLoading(false)
    }
  }

  const handleTogglePreference = (key: string) => {
    const newPreferences = { ...preferences, [key]: !preferences[key] }
    setPreferences(newPreferences)
    localStorage.setItem('emailPreferences', JSON.stringify(newPreferences))
    setMessage("Email preferences updated")

    // Clear message after 3 seconds
    setTimeout(() => setMessage(""), 3000)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Preferences</h2>
          <p className="text-sm text-gray-600 mt-1">
            Choose which email notifications you want to receive
          </p>
        </div>

        <button
          onClick={handleToggleEnabled}
          disabled={isLoading}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isEnabled
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isLoading ? "Updating..." : isEnabled ? "Email Enabled" : "Email Disabled"}
        </button>
      </div>

      {!isEnabled && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            ⚠️ Email notifications are currently disabled. Enable the toggle above to receive email updates.
          </p>
        </div>
      )}

      {message && (
        <div className={`mb-4 p-3 text-sm rounded ${
          message.includes("enabled") || message.includes("updated")
            ? "bg-green-50 text-green-800 border border-green-200"
            : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {message}
        </div>
      )}

      <div className={`space-y-3 ${!isEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {emailTypes.map((type) => {
          const isEnabled = preferences[type.key] !== false

          return (
            <div
              key={type.key}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{type.icon}</span>
                <div>
                  <div className="font-medium text-gray-900">{type.label}</div>
                  <div className="text-sm text-gray-600">{type.description}</div>
                </div>
              </div>

              <button
                onClick={() => handleTogglePreference(type.key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isEnabled ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          💡 Tip: Email notifications are sent when you're not actively using the app.
          Configure your email settings in the .env file for development.
        </p>
      </div>
    </div>
  )
}
