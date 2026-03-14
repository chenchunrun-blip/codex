"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { mapTaskOpsApiErrorFromPayload } from "@/lib/tasks/api-error"

type QueueDomain = "PRODUCT" | "ENGINEERING" | "QA" | "DESIGN" | "OPERATIONS"

type AgentItem = {
  id: string
  displayName?: string
  name: string
  capabilities?: string[] | null
  isActive?: boolean
}

type QueueTask = {
  id: string
  title: string
  status: string
  priority: number
  functionalAgentType?: string | null
}

interface AgentQueueConsoleProps {
  projectId?: string
}

const QUEUE_DOMAINS: QueueDomain[] = ["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]
const AGENTS_FETCH_TIMEOUT_MS = 8000
const AGENTS_FETCH_MAX_RETRIES = 2
const PULL_FETCH_TIMEOUT_MS = 8000
const PULL_FETCH_MAX_RETRIES = 2

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function AgentQueueConsole({ projectId }: AgentQueueConsoleProps) {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [refreshingAgents, setRefreshingAgents] = useState(false)
  const [loadingAction, setLoadingAction] = useState(false)
  const [domain, setDomain] = useState<QueueDomain>("ENGINEERING")
  const [agentId, setAgentId] = useState("")
  const [lastTask, setLastTask] = useState<QueueTask | null>(null)
  const [lastResultMessage, setLastResultMessage] = useState("")
  const [error, setError] = useState("")
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const isFetchingAgentsRef = useRef(false)

  const domainMatchedAgents = useMemo(() => {
    const domainText = domain.toLowerCase()
    return agents.filter((agent) =>
      Array.isArray(agent.capabilities)
        ? agent.capabilities.some(
            (item) => typeof item === "string" && item.trim().toLowerCase() === domainText
          )
        : false
    )
  }, [agents, domain])

  useEffect(() => {
    if (!agentId) return
    const stillMatched = domainMatchedAgents.some((agent) => agent.id === agentId)
    if (!stillMatched) {
      setAgentId("")
    }
  }, [agentId, domainMatchedAgents])

  const loadAgents = async (background = false) => {
    if (isFetchingAgentsRef.current) return
    isFetchingAgentsRef.current = true
    try {
      if (background) {
        setRefreshingAgents(true)
      } else {
        setLoadingAgents(true)
      }
      setError("")
      let response: Response | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt <= AGENTS_FETCH_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), AGENTS_FETCH_TIMEOUT_MS)
        try {
          response = await fetch("/api/agents", { signal: controller.signal })
          window.clearTimeout(timeout)
          break
        } catch (err) {
          window.clearTimeout(timeout)
          lastError = err
          if (attempt < AGENTS_FETCH_MAX_RETRIES) {
            await sleep(300 * (attempt + 1))
          }
        }
      }
      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("Failed to load agents")
      }
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapTaskOpsApiErrorFromPayload(payload, "Failed to load agents"))
      }
      const list = Array.isArray(payload?.agents) ? (payload.agents as AgentItem[]) : []
      setAgents(list.filter((item) => item.isActive !== false))
      setLastUpdatedAt(new Date().toISOString())
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load agents"
      setError(message)
      if (!background) {
        setAgents([])
      }
    } finally {
      isFetchingAgentsRef.current = false
      if (background) {
        setRefreshingAgents(false)
      } else {
        setLoadingAgents(false)
      }
    }
  }

  useEffect(() => {
    loadAgents().catch(() => undefined)
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible")
    }
    handleVisibility()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isPageVisible) return
      loadAgents(true).catch(() => undefined)
    }, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [isPageVisible])

  const handlePull = async (claim: boolean) => {
    if (!projectId) {
      setError("Please select a project first.")
      return
    }
    setLoadingAction(true)
    setError("")
    setLastResultMessage("")
    try {
      let response: Response | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt <= PULL_FETCH_MAX_RETRIES; attempt += 1) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), PULL_FETCH_TIMEOUT_MS)
        try {
          response = await fetch("/api/tasks/agent-queue/manual-pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              projectId,
              functionalAgentType: domain,
              claim,
              agentId: agentId || undefined
            })
          })
          window.clearTimeout(timeout)
          break
        } catch (err) {
          window.clearTimeout(timeout)
          lastError = err
          if (attempt < PULL_FETCH_MAX_RETRIES) {
            await sleep(300 * (attempt + 1))
          }
        }
      }
      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("Failed to pull queue task")
      }
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapTaskOpsApiErrorFromPayload(payload, "Failed to pull queue task"))
      }
      setLastTask(payload?.task || null)
      if (!payload?.task) {
        setLastResultMessage(`No pending task in ${domain} queue.`)
        return
      }
      setLastResultMessage(
        claim
          ? `Claimed task "${payload.task.title}" with agent ${payload.agentId}.`
          : `Peeked task "${payload.task.title}" in ${domain} queue.`
      )
    } catch (err) {
      setLastTask(null)
      setError(err instanceof Error ? err.message : "Failed to pull queue task")
    } finally {
      setLoadingAction(false)
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Agent Queue Console</h2>
          <button
            type="button"
            aria-label="Refresh agent list"
            onClick={() => loadAgents(true).catch(() => undefined)}
            disabled={loadingAgents || refreshingAgents || loadingAction}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingAgents || refreshingAgents ? "Refreshing..." : "Refresh Agents"}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Pull next queue task by domain and optionally claim it to an active agent.
        </p>
        <p className="mt-1 text-[11px] text-gray-500">Auto refresh: 30s</p>
        {lastUpdatedAt && (
          <p className="mt-1 text-[11px] text-gray-500">
            Last updated: {new Date(lastUpdatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {error && agents.length > 0 && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error} Showing last successful snapshot.
        </div>
      )}
      {error && agents.length === 0 && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {lastResultMessage && (
        <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">{lastResultMessage}</div>
      )}
      {loadingAgents && !refreshingAgents && (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Loading active agents...
        </div>
      )}
      {!loadingAgents && agents.length === 0 && !error && (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          No active agents available. Create or activate agents to claim queue tasks.
        </div>
      )}
      {!loadingAgents && agents.length > 0 && domainMatchedAgents.length === 0 && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No agent capability matches {domain}. Claim will auto-select from active agents only if available.
        </div>
      )}
      {!loadingAgents && agents.length > 0 && domainMatchedAgents.length > 0 && (
        <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {domainMatchedAgents.length} active agent{domainMatchedAgents.length === 1 ? "" : "s"} match {domain}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <select
          aria-label="Queue domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value as QueueDomain)}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          disabled={loadingAction}
        >
          {QUEUE_DOMAINS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          aria-label="Agent selection"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none md:col-span-2"
          disabled={loadingAction || loadingAgents}
        >
          <option value="">Auto-select active agent by domain</option>
          {domainMatchedAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {(agent.displayName || agent.name).trim()}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Peek next queue task"
            onClick={() => handlePull(false)}
            disabled={loadingAction || loadingAgents || !projectId}
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Peek
          </button>
          <button
            type="button"
            aria-label="Claim next queue task"
            onClick={() => handlePull(true)}
            disabled={loadingAction || loadingAgents || !projectId}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Claim
          </button>
        </div>
      </div>

      {lastTask && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <span className="font-medium">Last Task:</span> {lastTask.title} ({lastTask.status}, P
          {lastTask.priority})
        </div>
      )}
    </div>
  )
}
