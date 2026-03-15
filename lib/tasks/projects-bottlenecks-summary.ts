import { AssigneeType, TaskStatus } from "@prisma/client"
import { computeTaskRisk } from "@/lib/tasks/risk"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"

export type ProjectQueueRow = {
  projectId: string
  functionalAgentType: string | null
  count: number
}

export type ProjectRiskTask = {
  id: string
  projectId: string
  status: TaskStatus
  dueDate: Date | null
  assigneeType: AssigneeType
  functionalAgentType: string | null
  specMarkdown: string | null
  latestRunStatus: "SUCCESS" | "FAILED" | null
}

export type ProjectBottleneckCardSummary = {
  atRiskDomainCount: number
  highRiskTaskCount: number
  highestRiskScore: number
  recommendationCount: number
}

export function deriveProjectsBottlenecksSummary(input: {
  projectIds: string[]
  queueRows: ProjectQueueRow[]
  riskTasks: ProjectRiskTask[]
  onlineAgentsByDomain: Map<string, number>
}): Map<string, ProjectBottleneckCardSummary> {
  const summaryMap = new Map<string, ProjectBottleneckCardSummary>()
  for (const projectId of input.projectIds) {
    summaryMap.set(projectId, {
      atRiskDomainCount: 0,
      highRiskTaskCount: 0,
      highestRiskScore: 0,
      recommendationCount: 0
    })
  }

  for (const row of input.queueRows) {
    const projectSummary = summaryMap.get(row.projectId)
    if (!projectSummary) continue
    if (!row.functionalAgentType) continue
    const online = input.onlineAgentsByDomain.get(row.functionalAgentType.toUpperCase()) || 0
    if (row.count > 0 && online === 0) {
      projectSummary.atRiskDomainCount += 1
    }
  }

  for (const task of input.riskTasks) {
    const projectSummary = summaryMap.get(task.projectId)
    if (!projectSummary) continue
    const specQualityScore = task.specMarkdown ? lintTaskSpecMarkdown(task.specMarkdown).score : null
    const risk = computeTaskRisk({
      dueDate: task.dueDate,
      latestAgentRunStatus: task.latestRunStatus,
      specQualityScore,
      assigneeType: task.assigneeType,
      functionalAgentType: task.functionalAgentType,
      status: task.status,
      onlineAgentsByDomain: input.onlineAgentsByDomain
    })
    if (risk.riskLevel === "HIGH") {
      projectSummary.highRiskTaskCount += 1
    }
    projectSummary.highestRiskScore = Math.max(projectSummary.highestRiskScore, risk.riskScore)
  }

  for (const [, projectSummary] of summaryMap) {
    projectSummary.recommendationCount =
      projectSummary.atRiskDomainCount + projectSummary.highRiskTaskCount
  }

  return summaryMap
}
