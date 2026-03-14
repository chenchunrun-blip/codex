export interface AgentQueueTaskItem {
  id: string
  title: string
  assigneeType?: string
  functionalAgentType?: string | null
}

export interface AgentQueueTaskGroup {
  key: string
  label: string
  tasks: AgentQueueTaskItem[]
}

const GROUP_LABELS: Record<string, string> = {
  PRODUCT: "Product",
  ENGINEERING: "Engineering",
  QA: "QA",
  DESIGN: "Design",
  OPERATIONS: "Operations",
  AGENT_OTHER: "Agent (Other)",
  HUMAN: "Human",
  UNASSIGNED: "Unassigned"
}

const GROUP_ORDER = [
  "PRODUCT",
  "ENGINEERING",
  "QA",
  "DESIGN",
  "OPERATIONS",
  "AGENT_OTHER",
  "HUMAN",
  "UNASSIGNED"
]

export function getAgentQueueGroupKey(task: AgentQueueTaskItem): string {
  if (task.functionalAgentType) return task.functionalAgentType
  if (task.assigneeType === "FUNCTIONAL_AGENT" || task.assigneeType === "AGENT") return "AGENT_OTHER"
  if (task.assigneeType === "HUMAN") return "HUMAN"
  return "UNASSIGNED"
}

export function groupTasksByAgentQueue<T extends AgentQueueTaskItem>(tasks: T[]): AgentQueueTaskGroup[] {
  const buckets = new Map<string, T[]>()

  for (const task of tasks) {
    const key = getAgentQueueGroupKey(task)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(task)
  }

  return GROUP_ORDER
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      key,
      label: GROUP_LABELS[key] || key,
      tasks: buckets.get(key)!,
    }))
}

// Backward-compatible aliases (can be removed after all callers migrate).
export type FunctionalTaskItem = AgentQueueTaskItem
export type FunctionalTaskGroup = AgentQueueTaskGroup
export const getFunctionalGroupKey = getAgentQueueGroupKey
export const groupTasksByFunctionalType = groupTasksByAgentQueue
