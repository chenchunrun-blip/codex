"use client"

import { useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export function ExportAgentWorkloadButton() {
  const [loading, setLoading] = useState(false)

  const exportReport = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/agents/workload")
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch agent workload"))
      }

      const lines: string[] = []
      lines.push("# Agent Workload Report")
      lines.push("")
      lines.push(`- Generated At: ${payload.generatedAt || new Date().toISOString()}`)
      lines.push(`- Total Agents: ${payload?.summary?.totalAgents || 0}`)
      lines.push(`- Active Agents: ${payload?.summary?.activeAgents || 0}`)
      lines.push(`- Online Agents: ${payload?.summary?.onlineAgents || 0}`)
      lines.push(`- Total Active Tasks: ${payload?.summary?.totalActiveTasks || 0}`)
      lines.push(`- Failed Runs (window): ${payload?.summary?.failedRunsInWindow || 0}`)
      lines.push(`- Window Hours: ${payload?.summary?.windowHours || 24}`)
      lines.push("")
      lines.push("| Agent | Active | Online | Active Tasks | Queue Backlog | Runs Success | Runs Failed | Last Active |")
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
      for (const agent of Array.isArray(payload?.agents) ? payload.agents : []) {
        lines.push(
          `| ${(agent.displayName || agent.name || "Agent").replace(/\|/g, "\\|")} | ${agent.isActive ? "yes" : "no"} | ${agent.isOnline ? "yes" : "no"} | ${agent?.workload?.activeTasks || 0} | ${agent?.queuePressure?.backlog || 0} | ${agent?.recentRuns?.success || 0} | ${agent?.recentRuns?.failed || 0} | ${agent?.lastActiveAt || ""} |`
        )
      }

      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `agent-workload-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Failed to export agent workload report:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={exportReport}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
    >
      {loading ? "Exporting..." : "Export Workload"}
    </button>
  )
}
