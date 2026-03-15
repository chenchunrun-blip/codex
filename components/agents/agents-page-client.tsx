"use client"

import { useState, useEffect } from "react"
import { AgentList } from "@/components/agents/agent-list"
import { AgentWorkloadOverview } from "@/components/agents/agent-workload-overview"
import { AgentCreateDialog } from "@/components/agents/agent-create-dialog"
import { ExportAgentWorkloadButton } from "@/components/agents/export-agent-workload-button"
import { SaveAgentWorkloadButton } from "@/components/agents/save-agent-workload-button"
import { ExportAgentQueueStatusButton } from "@/components/reports/export-agent-queue-status-button"
import { SaveAgentQueueStatusButton } from "@/components/reports/save-agent-queue-status-button"
import { ExportOperationsStatusButton } from "@/components/reports/export-operations-status-button"
import { SaveOperationsStatusButton } from "@/components/reports/save-operations-status-button"
import { AgentQueueStatus } from "@/components/tasks/agent-queue-status"
import { OperationsStatusPanel } from "@/components/tasks/operations-status-panel"
import { OperationsHealthBanner } from "@/components/operations/operations-health-banner"
import { Plus, RefreshCw } from "lucide-react"

export function AgentsPageClient() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)

  const checkAdminStatus = async () => {
    try {
      const res = await fetch("/api/user/profile")
      if (res.ok) {
        const data = await res.json()
        const hasAdmin = data.teamMemberships?.some(
          (m: { role: string }) => m.role === "ADMIN"
        )
        setIsAdmin(hasAdmin || false)
      }
    } catch (error) {
      console.error("Failed to check admin status:", error)
    }
  }

  useEffect(() => {
    checkAdminStatus()
  }, [])

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1)
  }

  const handleAgentCreated = () => {
    setShowCreateDialog(false)
    handleRefresh()
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Agents</h1>
          <p className="text-gray-600 mt-1">
            Manage AI agents that can execute tasks via MCP protocol
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportAgentWorkloadButton />
          <SaveAgentWorkloadButton />
          <ExportAgentQueueStatusButton />
          <SaveAgentQueueStatusButton />
          <ExportOperationsStatusButton />
          <SaveOperationsStatusButton />
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Register Agent
            </button>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-blue-800 mb-1">
          How AI Agents Work
        </h3>
        <p className="text-sm text-blue-700">
          AI agents can connect to Marqdex via the MCP (Model Context Protocol) to
          receive and execute tasks. Each agent has its own API key for secure
          authentication. Agents can read project files, submit deliverables, and
          update task status.
        </p>
      </div>

      <AgentWorkloadOverview />
      <AgentQueueStatus />
      <OperationsHealthBanner />
      <OperationsStatusPanel />

      <AgentList key={refreshKey} />

      {showCreateDialog && (
        <AgentCreateDialog
          isOpen={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          onCreated={handleAgentCreated}
        />
      )}
    </div>
  )
}
