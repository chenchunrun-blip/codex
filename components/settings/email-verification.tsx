"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface EmailVerificationProps {
  email: string
  emailVerified: boolean | null
}

export function EmailVerification({ email, emailVerified }: EmailVerificationProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("")
  const isVerified = !!emailVerified

  const handleSendVerification = async () => {
    setIsLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST"
      })

      const data = await response.json()

      if (!response.ok) {
        setMessage(mapReportApiErrorFromPayload(data, "Failed to send verification email"))
      } else {
        setMessage("Verification email sent! Please check your inbox.")
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send verification email")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Verification</h2>
          <p className="text-sm text-gray-600 mt-1">{email}</p>
        </div>
        {isVerified ? (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
            ✓ Verified
          </span>
        ) : (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
            ⚠ Not Verified
          </span>
        )}
      </div>

      <div className="text-sm text-gray-600 mb-4">
        {isVerified ? (
          <p>Your email has been verified. Your account is now secured.</p>
        ) : (
          <p>
            Verify your email address to secure your account and receive important notifications.
          </p>
        )}
      </div>

      {!isVerified && (
        <div className="space-y-3">
          {message && (
            <div className={`p-3 text-sm rounded ${
              message.includes("sent") || message.includes("Verification")
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}>
              {message}
            </div>
          )}

          <button
            onClick={handleSendVerification}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Sending..." : "Send Verification Email"}
          </button>
        </div>
      )}
    </div>
  )
}
