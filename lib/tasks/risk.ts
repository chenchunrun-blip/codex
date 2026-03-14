import { AssigneeType, TaskStatus } from "@prisma/client"

export type TaskRiskInput = {
  dueDate: Date | null
  latestAgentRunStatus: "SUCCESS" | "FAILED" | null
  specQualityScore: number | null
  assigneeType: AssigneeType
  functionalAgentType: string | null
  status: TaskStatus
  onlineAgentsByDomain?: Map<string, number>
}

export type TaskRiskResult = {
  riskScore: number
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  riskReasons: string[]
}

export function computeTaskRisk(input: TaskRiskInput): TaskRiskResult {
  let riskScore = 0
  const riskReasons: string[] = []
  const now = Date.now()

  if (input.dueDate) {
    const msLeft = input.dueDate.getTime() - now
    const daysLeft = msLeft / (24 * 60 * 60 * 1000)
    if (daysLeft <= 1) {
      riskScore += 40
      riskReasons.push("Due within 24 hours")
    } else if (daysLeft <= 3) {
      riskScore += 25
      riskReasons.push("Due within 3 days")
    }
  }

  if (input.latestAgentRunStatus === "FAILED") {
    riskScore += 25
    riskReasons.push("Latest agent run failed")
  }

  if (typeof input.specQualityScore === "number" && input.specQualityScore < 60) {
    riskScore += 20
    riskReasons.push("Low TaskSpec quality")
  }

  if (
    input.assigneeType === AssigneeType.FUNCTIONAL_AGENT &&
    input.functionalAgentType &&
    (input.status === TaskStatus.PENDING || input.status === TaskStatus.IN_PROGRESS)
  ) {
    const onlineForDomain = input.onlineAgentsByDomain?.get(input.functionalAgentType.toUpperCase()) || 0
    if (onlineForDomain === 0) {
      riskScore += 30
      riskReasons.push(`No online agent in ${input.functionalAgentType} domain`)
    }
  }

  const normalizedRisk = Math.min(100, Math.max(0, riskScore))
  const riskLevel = normalizedRisk >= 70 ? "HIGH" : normalizedRisk >= 40 ? "MEDIUM" : "LOW"
  return {
    riskScore: normalizedRisk,
    riskLevel,
    riskReasons
  }
}
