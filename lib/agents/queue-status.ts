import { db } from "@/lib/db"
import { isAgentOnline } from "@/lib/tasks/agent-selection"
import { AssigneeType, FunctionalAgentType } from "@prisma/client"

export const AGENT_QUEUE_DOMAINS: FunctionalAgentType[] = [
  FunctionalAgentType.PRODUCT,
  FunctionalAgentType.ENGINEERING,
  FunctionalAgentType.QA,
  FunctionalAgentType.DESIGN,
  FunctionalAgentType.OPERATIONS
]

function logCompatibilityFallback(message: string, error: unknown) {
  if (process.env.NODE_ENV === "test") return
  console.warn(message, error)
}

async function loadActiveAgents() {
  try {
    return await db.agent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        capabilities: true,
        updatedAt: true
      }
    })
  } catch (error) {
    logCompatibilityFallback("Queue status agent fallback #1:", error)
    return []
  }
}

async function loadBacklogGrouped(projectId?: string) {
  try {
    return await db.task.groupBy({
      by: ["functionalAgentType"],
      where: {
        ...(projectId ? { projectId } : {}),
        assigneeType: AssigneeType.FUNCTIONAL_AGENT,
        status: { in: ["PENDING", "IN_PROGRESS"] }
      },
      _count: { _all: true }
    })
  } catch (error) {
    logCompatibilityFallback("Queue status backlog fallback #1:", error)
  }

  try {
    return await db.task.groupBy({
      by: ["functionalAgentType"],
      where: {
        ...(projectId ? { projectId } : {}),
        assigneeType: AssigneeType.AGENT,
        status: { in: ["PENDING", "IN_PROGRESS"] }
      },
      _count: { _all: true }
    })
  } catch (error) {
    logCompatibilityFallback("Queue status backlog fallback #2:", error)
  }

  try {
    const rows = await db.task.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        assigneeType: { in: [AssigneeType.FUNCTIONAL_AGENT, AssigneeType.AGENT] },
        status: { in: ["PENDING", "IN_PROGRESS"] }
      },
      select: {
        functionalAgentType: true
      }
    })

    const map = new Map<string | null, number>()
    for (const row of rows) {
      const key = row.functionalAgentType || null
      map.set(key, (map.get(key) || 0) + 1)
    }
    return Array.from(map.entries()).map(([functionalAgentType, count]) => ({
      functionalAgentType,
      _count: { _all: count }
    }))
  } catch (error) {
    logCompatibilityFallback("Queue status backlog fallback #3:", error)
  }

  try {
    const rows = await db.task.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: { in: ["PENDING", "IN_PROGRESS"] }
      },
      select: {
        id: true
      }
    })

    return [
      {
        functionalAgentType: null,
        _count: { _all: rows.length }
      }
    ]
  } catch (error) {
    logCompatibilityFallback("Queue status backlog fallback #4:", error)
    return []
  }
}

export async function resolveAgentQueueStatus(projectId?: string) {
  const [backlogGrouped, agents] = await Promise.all([
    loadBacklogGrouped(projectId),
    loadActiveAgents()
  ])

  const backlogMap = new Map<string, number>()
  for (const row of backlogGrouped) {
    const key = row.functionalAgentType || "UNSPECIFIED"
    backlogMap.set(key, row._count._all)
  }

  const domains = AGENT_QUEUE_DOMAINS.map((domain) => {
    const domainText = domain.toLowerCase()
    const matchedAgents = agents.filter((agent) =>
      Array.isArray(agent.capabilities)
        ? agent.capabilities.some(
            (item) => typeof item === "string" && item.trim().toLowerCase() === domainText
          )
        : false
    )

    return {
      domain,
      backlog: backlogMap.get(domain) ?? 0,
      activeAgents: matchedAgents.length,
      onlineAgents: matchedAgents.filter((agent) => isAgentOnline(agent.updatedAt)).length
    }
  })

  return {
    projectId: projectId || null,
    domains
  }
}
