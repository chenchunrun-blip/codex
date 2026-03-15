"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

type BottlenecksResponse = {
  queueBacklog: Array<{ domain: string; backlog: number; onlineAgents: number }>
  atRiskDomains: Array<{ domain: string; backlog: number; onlineAgents: number }>
  highRiskTasks: Array<{
    id: string
    title: string
    status: string
    riskScore: number
    riskLevel: "LOW" | "MEDIUM" | "HIGH"
    riskReasons: string[]
  }>
  recommendations: Array<{
    type: "QUEUE" | "TASK"
    title: string
    action: string
  }>
}

interface ProjectBottlenecksPanelProps {
  projectId: string
}

export function ProjectBottlenecksPanel({ projectId }: ProjectBottlenecksPanelProps) {
  const [data, setData] = useState<BottlenecksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreatingRemediation, setIsCreatingRemediation] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/bottlenecks`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(body, "Failed to fetch project bottlenecks"))
      }
      const payload = (await res.json()) as BottlenecksResponse
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch project bottlenecks")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = window.setInterval(fetchData, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [projectId])

  const exportMarkdown = async () => {
    setIsExporting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/bottlenecks?format=markdown`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(body, "Failed to export project bottlenecks report"))
      }
      const markdown = await res.text()
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `project-bottlenecks-${projectId}.md`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export project bottlenecks report")
    } finally {
      setIsExporting(false)
    }
  }

  const saveAsFile = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/bottlenecks/save`, {
        method: "POST"
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(mapReportApiErrorFromPayload(body, "Failed to save bottlenecks report"))
      }
      if (body?.file?.id) {
        window.location.href = `/editor/${body.file.id}`
      } else {
        await fetchData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bottlenecks report")
    } finally {
      setIsSaving(false)
    }
  }

  const createRemediationTasks = async () => {
    setIsCreatingRemediation(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/bottlenecks/remediation-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5, applyDispatchFallback: true })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(mapReportApiErrorFromPayload(body, "Failed to create remediation tasks"))
      }
      const total = typeof body?.total === "number" ? body.total : 0
      const dispatchUpdated = body?.dispatchPolicyUpdate?.changed === true
      const message = dispatchUpdated
        ? `Created ${total} remediation task${total === 1 ? "" : "s"} and disabled online-only dispatch due to at-risk queues.`
        : `Created ${total} remediation task${total === 1 ? "" : "s"}.`
      setInfo(message)
      const firstTaskId = Array.isArray(body?.created) ? body.created[0]?.id : null
      if (firstTaskId) {
        window.location.href = `/tasks/${firstTaskId}`
      } else {
        await fetchData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create remediation tasks")
    } finally {
      setIsCreatingRemediation(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-5 w-44 rounded bg-gray-200 animate-pulse mb-3" />
        <div className="h-4 w-full rounded bg-gray-100 animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
    )
  }

  if (!data) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Project Bottlenecks</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={createRemediationTasks}
            disabled={isCreatingRemediation}
            className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {isCreatingRemediation ? "Creating..." : "Create Remediation Tasks"}
          </button>
          <button
            type="button"
            onClick={saveAsFile}
            disabled={isSaving}
            className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save as File"}
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            disabled={isExporting}
            className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            {isExporting ? "Exporting..." : "Export .md"}
          </button>
          <button
            type="button"
            onClick={fetchData}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {info && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          {info}
        </div>
      )}

      {data.atRiskDomains.length > 0 ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-800 mb-2">At-Risk Queue Domains</div>
          <div className="space-y-1">
            {data.atRiskDomains.map((item) => (
              <div key={item.domain} className="text-xs text-red-700">
                {item.domain}: backlog {item.backlog}, online agents {item.onlineAgents}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-xs text-green-700">
          No queue-domain bottlenecks detected.
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-gray-700 mb-2">High-Risk Tasks</div>
        {data.highRiskTasks.length === 0 ? (
          <div className="text-xs text-gray-500">No high-risk tasks.</div>
        ) : (
          <div className="space-y-2">
            {data.highRiskTasks.slice(0, 8).map((task) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="block rounded border border-gray-200 p-2 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-gray-900 truncate">{task.title}</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                    {task.riskLevel} {task.riskScore}
                  </span>
                </div>
                {task.riskReasons.length > 0 && (
                  <div className="mt-1 text-xs text-gray-600 truncate">{task.riskReasons.join("; ")}</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-gray-700 mb-2">Recommendations</div>
        <div className="space-y-2">
          {data.recommendations.map((item, idx) => (
            <div key={`${item.type}-${idx}`} className="rounded border border-gray-200 p-2">
              <div className="text-xs font-medium text-gray-900">
                [{item.type}] {item.title}
              </div>
              <div className="text-xs text-gray-600 mt-1">{item.action}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
