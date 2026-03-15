"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface AgentWorkloadRow {
  id: string
  name: string
  displayName: string
  isActive: boolean
  isOnline: boolean
  workload: {
    pending: number
    inProgress: number
    review: number
    activeTasks: number
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

interface WorkloadResponse {
  summary: {
    totalAgents: number
    activeAgents: number
    onlineAgents: number
    totalActiveTasks: number
    failedRunsInWindow: number
    windowHours: number
  }
  agents: AgentWorkloadRow[]
}

export function AgentWorkloadOverview() {
  const [data, setData] = useState<WorkloadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkload = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agents/workload?hours=24")
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch agent workload"))
      }
      const payload = await res.json()
      setData(payload)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to fetch agent workload")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkload()
    const timer = window.setInterval(fetchWorkload, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="h-5 w-52 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
        <div className="text-sm font-medium text-red-700 mb-1">Failed to load agent workload</div>
        <div className="text-xs text-red-600 mb-3">{error}</div>
        <button
          onClick={fetchWorkload}
          className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }
  if (!data) return null

  const topBusyAgents = [...data.agents]
    .sort((a, b) => b.workload.activeTasks - a.workload.activeTasks)
    .slice(0, 5)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Agent Workload Overview (24h)</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-500">Total Agents</div>
          <div className="text-base font-semibold text-gray-900">{data.summary.totalAgents}</div>
        </div>
        <div className="rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-500">Online</div>
          <div className="text-base font-semibold text-green-700">{data.summary.onlineAgents}</div>
        </div>
        <div className="rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-500">Active Tasks</div>
          <div className="text-base font-semibold text-blue-700">{data.summary.totalActiveTasks}</div>
        </div>
        <div className="rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-500">Failed Runs</div>
          <div className="text-base font-semibold text-red-700">{data.summary.failedRunsInWindow}</div>
        </div>
        <div className="rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-500">Window</div>
          <div className="text-base font-semibold text-gray-900">{data.summary.windowHours}h</div>
        </div>
      </div>

      <div className="space-y-2">
        {topBusyAgents.map((agent) => (
          <div key={agent.id} className="flex items-center justify-between border border-gray-100 rounded p-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{agent.displayName || agent.name}</div>
              <div className="text-xs text-gray-500">
                queue backlog: {agent.queuePressure.backlog} | success: {agent.recentRuns.success} | failed: {agent.recentRuns.failed}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded ${agent.isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>
                {agent.isOnline ? "Online" : "Idle"}
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                active: {agent.workload.activeTasks}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
