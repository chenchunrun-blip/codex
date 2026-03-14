"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

interface Member {
  id: string
  role: 'ADMIN' | 'MEMBER'
  user: {
    id: string
    name: string | null
    email: string
    avatar: string | null
  }
}

interface TeamMembersProps {
  teamId: string
  members: Member[]
  currentUserRole?: 'ADMIN' | 'MEMBER'
  onUpdate: () => void
}

export function TeamMembers({ teamId, members, currentUserRole = 'MEMBER', onUpdate }: TeamMembersProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [bulkEmails, setBulkEmails] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [bulkRole, setBulkRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const requestOptions = { timeoutMs: 8000, maxRetries: 2, retryDelayMs: 300 }

  const requestJson = async (url: string, init: RequestInit | undefined, fallback: string) => {
    const response = await fetchWithTimeoutRetry(url, init, requestOptions)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(mapReportApiErrorFromPayload(payload, fallback))
    }
    return payload
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Find user by email
      const usersPayload = await requestJson(
        `/api/users/search?q=${encodeURIComponent(newMemberEmail)}&teamId=${teamId}`,
        undefined,
        "Failed to search for user"
      )
      const users = Array.isArray(usersPayload) ? usersPayload : []
      if (!users || users.length === 0) {
        setError('User not found. Please check the email.')
        return
      }

      const user = users[0]

      // Add member to team
      await requestJson(
        `/api/teams/${teamId}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            role: 'MEMBER'
          })
        },
        "Failed to add member"
      )

      setNewMemberEmail("")
      setIsAdding(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }

  const handleBulkAddMembers = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bulkEmails.trim()) return
    setLoading(true)
    setError(null)
    try {
      const emails = Array.from(
        new Set(
          bulkEmails
            .split(/[\s,;\n]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
        )
      )
      if (emails.length === 0) {
        setError("Please provide at least one valid email")
        return
      }
      await requestJson(
        `/api/teams/${teamId}/members/bulk-add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails,
            role: "MEMBER"
          })
        },
        "Failed to bulk add members"
      )
      setBulkEmails("")
      setIsAdding(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to bulk add members")
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return

    setLoading(true)
    setError(null)

    try {
      await requestJson(
        `/api/teams/${teamId}/members/${userId}`,
        {
          method: 'DELETE'
        },
        "Failed to remove member"
      )

      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateRole = async (userId: string, newRole: 'ADMIN' | 'MEMBER') => {
    setLoading(true)
    setError(null)

    try {
      await requestJson(
        `/api/teams/${teamId}/members/${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole })
        },
        "Failed to update role"
      )

      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = currentUserRole === 'ADMIN'
  const allSelected = members.length > 0 && selectedUserIds.length === members.length

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUserIds(members.map((member) => member.user.id))
      return
    }
    setSelectedUserIds([])
  }

  const toggleUserSelected = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]))
      return
    }
    setSelectedUserIds((prev) => prev.filter((id) => id !== userId))
  }

  const applyBulkRole = async () => {
    if (!isAdmin || selectedUserIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await requestJson(
        `/api/teams/${teamId}/members/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SET_ROLE",
            role: bulkRole,
            userIds: selectedUserIds
          })
        },
        "Failed to apply bulk role update"
      )
      setSelectedUserIds([])
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply bulk role update")
    } finally {
      setLoading(false)
    }
  }

  const removeSelectedMembers = async () => {
    if (!isAdmin || selectedUserIds.length === 0) return
    if (!confirm(`Remove ${selectedUserIds.length} selected member(s)?`)) return
    setLoading(true)
    setError(null)
    try {
      await requestJson(
        `/api/teams/${teamId}/members/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "REMOVE",
            userIds: selectedUserIds
          })
        },
        "Failed to remove selected members"
      )
      setSelectedUserIds([])
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove selected members")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Team Members ({members.length})</h3>
        {isAdmin && (
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
          >
            {isAdding ? 'Cancel' : 'Add Member'}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {isAdding && isAdmin && (
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <form onSubmit={handleAddMember} className="flex gap-2">
            <input
              type="email"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="Enter member email"
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add'}
            </button>
          </form>
          <form onSubmit={handleBulkAddMembers} className="mt-3 space-y-2">
            <textarea
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              rows={3}
              placeholder="Bulk add by email, separated by comma / space / newline"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-blue-700 border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50"
              >
                {loading ? "Adding..." : "Bulk Add Members"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isAdmin && (
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                disabled={loading || members.length === 0}
              />
              Select all
            </label>
            <select
              value={bulkRole}
              onChange={(e) => setBulkRole(e.target.value as 'ADMIN' | 'MEMBER')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading || selectedUserIds.length === 0}
            >
              <option value="MEMBER">Set role: Member</option>
              <option value="ADMIN">Set role: Admin</option>
            </select>
            <button
              type="button"
              onClick={applyBulkRole}
              disabled={loading || selectedUserIds.length === 0}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Apply to Selected ({selectedUserIds.length})
            </button>
            <button
              type="button"
              onClick={removeSelectedMembers}
              disabled={loading || selectedUserIds.length === 0}
              className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Remove Selected
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {members.map((member) => (
          <div key={member.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {isAdmin && (
                <input
                  type="checkbox"
                  checked={selectedUserIds.includes(member.user.id)}
                  onChange={(e) => toggleUserSelected(member.user.id, e.target.checked)}
                  className="mr-1"
                />
              )}
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                {(member.user.name || member.user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">
                  {member.user.name || member.user.email}
                </p>
                <p className="text-sm text-gray-500 truncate">{member.user.email}</p>
              </div>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <select
                  value={member.role}
                  onChange={(e) => handleUpdateRole(member.user.id, e.target.value as 'ADMIN' | 'MEMBER')}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button
                  onClick={() => handleRemoveMember(member.user.id)}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}

            {!isAdmin && (
              <span className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded">
                {member.role}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
