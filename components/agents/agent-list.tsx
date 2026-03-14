"use client"

import { useState, useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, Plus, Bot } from "lucide-react"
import { AgentCard } from "./agent-card"
import { AgentCreateDialog } from "./agent-create-dialog"
import { AgentEditDialog } from "./agent-edit-dialog"
import { AgentDetailPanel } from "./agent-detail-panel"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Agent {
  id: string
  name: string
  displayName: string
  description: string | null
  type: string
  capabilities: string[] | null
  lastActiveAt: Date | null
  isOnline?: boolean
  isActive: boolean
  _count: {
    tasks: number
  }
  workload?: {
    activeTasks: number
  }
  recentRuns?: {
    failed: number
    success: number
  }
  queuePressure?: {
    backlog: number
  }
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.trunc(parsed)
  if (normalized < min || normalized > max) return fallback
  return normalized
}

export function AgentList() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [viewingAgentId, setViewingAgentId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("agentQ") || "")
  const [capabilityFilter, setCapabilityFilter] = useState<string>(
    () => searchParams.get("agentCapability") || "all"
  )
  const [statusFilter, setStatusFilter] = useState<string>(
    () => searchParams.get("agentStatus") || "all"
  )
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1, 1, 999))
  const [pageSize, setPageSize] = useState(() =>
    parsePositiveInt(searchParams.get("limit"), 12, 12, 48)
  )
  const skipInitialFilterResetRef = useRef(true)

  useEffect(() => {
    fetchAgents()

    const timer = window.setInterval(() => {
      fetchAgents()
    }, 30 * 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const fetchAgents = async () => {
    setLoading(true)
    setError(null)

    try {
      const [agentsRes, workloadRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/agents/workload?hours=24")
      ])
      if (!agentsRes.ok) {
        const payload = await agentsRes.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch agents"))
      }

      const data = await agentsRes.json()
      const workload = workloadRes.ok ? await workloadRes.json() : null
      const workloadMap = new Map<string, any>(
        Array.isArray(workload?.agents)
          ? workload.agents.map((item: any) => [item.id, item])
          : []
      )
      const mergedAgents = (data.agents || []).map((agent: Agent) => {
        const extra = workloadMap.get(agent.id)
        return {
          ...agent,
          workload: extra?.workload ? { activeTasks: extra.workload.activeTasks } : undefined,
          recentRuns: extra?.recentRuns
            ? { failed: extra.recentRuns.failed, success: extra.recentRuns.success }
            : undefined,
          queuePressure: extra?.queuePressure
            ? { backlog: extra.queuePressure.backlog }
            : undefined
        }
      })
      setAgents(mergedAgents)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents")
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm("Are you sure you want to delete this agent? This action cannot be undone.")) {
      return
    }
    setActionError(null)

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setActionError(mapReportApiErrorFromPayload(data, "Failed to delete agent"))
        return
      }

      fetchAgents()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete agent")
    }
  }

  const allCapabilities = Array.from(
    new Set(agents.flatMap(a => Array.isArray(a.capabilities) ? a.capabilities : []))
  ).sort()

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      searchQuery === "" ||
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (agent.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (agent.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)

    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : []
    const matchesCapability =
      capabilityFilter === "all" || capabilities.includes(capabilityFilter)

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "online" && agent.isOnline) ||
      (statusFilter === "offline" && !agent.isOnline) ||
      (statusFilter === "active" && agent.isActive) ||
      (statusFilter === "inactive" && !agent.isActive) ||
      (statusFilter === "busy" && (agent.workload?.activeTasks || 0) > 0)

    return matchesSearch && matchesCapability && matchesStatus
  })
  const pagedAgents = filteredAgents.slice((page - 1) * pageSize, page * pageSize)
  const hasMoreAgents = page * pageSize < filteredAgents.length

  useEffect(() => {
    const nextPage = parsePositiveInt(searchParams.get("page"), 1, 1, 999)
    const nextPageSize = parsePositiveInt(searchParams.get("limit"), 12, 12, 48)
    const nextSearchQuery = searchParams.get("agentQ") || ""
    const nextCapabilityFilter = searchParams.get("agentCapability") || "all"
    const nextStatusFilter = searchParams.get("agentStatus") || "all"
    setPage((current) => (current === nextPage ? current : nextPage))
    setPageSize((current) => (current === nextPageSize ? current : nextPageSize))
    setSearchQuery((current) => (current === nextSearchQuery ? current : nextSearchQuery))
    setCapabilityFilter((current) =>
      current === nextCapabilityFilter ? current : nextCapabilityFilter
    )
    setStatusFilter((current) => (current === nextStatusFilter ? current : nextStatusFilter))
  }, [searchParams])

  useEffect(() => {
    if (skipInitialFilterResetRef.current) {
      skipInitialFilterResetRef.current = false
      return
    }
    setPage(1)
  }, [searchQuery, capabilityFilter, statusFilter])

  useEffect(() => {
    if (loading) return
    const maxPage = Math.max(1, Math.ceil(filteredAgents.length / pageSize))
    if (page > maxPage) {
      setPage(maxPage)
    }
  }, [filteredAgents.length, loading, page, pageSize])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())
    if (page > 1) nextParams.set("page", String(page))
    else nextParams.delete("page")
    if (pageSize !== 12) nextParams.set("limit", String(pageSize))
    else nextParams.delete("limit")
    if (searchQuery) nextParams.set("agentQ", searchQuery)
    else nextParams.delete("agentQ")
    if (capabilityFilter !== "all") nextParams.set("agentCapability", capabilityFilter)
    else nextParams.delete("agentCapability")
    if (statusFilter !== "all") nextParams.set("agentStatus", statusFilter)
    else nextParams.delete("agentStatus")

    const currentQuery = searchParams.toString()
    const nextQuery = nextParams.toString()
    if (currentQuery === nextQuery) return
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [page, pageSize, searchQuery, capabilityFilter, statusFilter, pathname, router, searchParams])

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
              <div className="flex-1">
                <div className="h-5 bg-gray-200 rounded w-3/4 mb-1"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
            <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-600 font-medium mb-2">Failed to load agents</p>
        <p className="text-red-500 text-sm mb-4">{error}</p>
        <button
          onClick={fetchAgents}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filteredAgents.length} {filteredAgents.length === 1 ? "agent" : "agents"}
          </p>
        </div>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>
      {actionError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Search */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Capability Filter */}
          <div>
            <select
              value={capabilityFilter}
              onChange={(e) => setCapabilityFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Capabilities</option>
              {allCapabilities.map((capability) => (
                <option key={capability} value={capability}>
                  {capability}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Status</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="busy">Busy (has tasks)</option>
            </select>
          </div>

          <div>
            <select
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="12">12 / page</option>
              <option value="24">24 / page</option>
              <option value="48">48 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      {filteredAgents.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No agents found</h3>
          <p className="text-gray-500 mb-6">
            {searchQuery || capabilityFilter !== "all"
              || statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Get started by registering your first AI agent"}
          </p>
          {!searchQuery && capabilityFilter === "all" && statusFilter === "all" && (
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Agent
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pagedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onView={(id) => setViewingAgentId(id)}
                onEdit={(id) => setEditingAgentId(id)}
                onDelete={handleDeleteAgent}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">
              Page {page}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => (hasMoreAgents ? current + 1 : current))}
              disabled={!hasMoreAgents}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Dialogs */}
      <AgentCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={fetchAgents}
      />

      <AgentEditDialog
        isOpen={editingAgentId !== null}
        agentId={editingAgentId}
        onClose={() => setEditingAgentId(null)}
        onUpdated={fetchAgents}
        onDeleted={fetchAgents}
      />

      <AgentDetailPanel
        isOpen={viewingAgentId !== null}
        agentId={viewingAgentId}
        onClose={() => setViewingAgentId(null)}
        onEdit={(id) => {
          setViewingAgentId(null)
          setEditingAgentId(id)
        }}
      />
    </div>
  )
}
