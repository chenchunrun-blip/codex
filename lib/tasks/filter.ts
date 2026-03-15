export interface TaskFilterItem {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  dueDate: Date | null
  createdAt: Date
  project: {
    id: string
    name: string
  } | null
  assignee: {
    id: string
    name: string | null
  } | null
  assigneeType?: string
  assignmentMode?: string
  riskLevel?: "LOW" | "MEDIUM" | "HIGH"
  deliverables: Array<{
    id: string
    status: string
  }>
}

export interface TaskFilterOptions {
  searchQuery: string
  statusFilter: string
  priorityFilter: string
  projectFilter: string
  assigneeFilter: string
  assigneeTypeFilter: string
  assignmentModeFilter: string
  riskFilter: string
}

export function filterTasks<T extends TaskFilterItem>(tasks: T[], options: TaskFilterOptions): T[] {
  return tasks.filter((task) => {
    const matchesSearch =
      options.searchQuery === "" ||
      task.title.toLowerCase().includes(options.searchQuery.toLowerCase()) ||
      (task.description?.toLowerCase().includes(options.searchQuery.toLowerCase()) ?? false)

    const matchesStatus = options.statusFilter === "all" || task.status === options.statusFilter
    const priorityMap: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 }
    const matchesPriority =
      options.priorityFilter === "all" || task.priority === priorityMap[options.priorityFilter]
    const matchesProject = options.projectFilter === "all" || task.project?.id === options.projectFilter
    const matchesAssignee = options.assigneeFilter === "all" || task.assignee?.id === options.assigneeFilter
    const matchesAssigneeType =
      options.assigneeTypeFilter === "all" || task.assigneeType === options.assigneeTypeFilter
    const matchesAssignmentMode =
      options.assignmentModeFilter === "all" || task.assignmentMode === options.assignmentModeFilter
    const matchesRiskLevel = options.riskFilter === "all" || task.riskLevel === options.riskFilter

    return (
      matchesSearch &&
      matchesStatus &&
      matchesPriority &&
      matchesProject &&
      matchesAssignee &&
      matchesAssigneeType &&
      matchesAssignmentMode &&
      matchesRiskLevel
    )
  })
}
