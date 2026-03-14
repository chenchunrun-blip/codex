"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, Calendar, User, MessageSquare, Plus, MoreVertical } from "lucide-react"
import { TaskStatusBadge, TaskPriorityBadge } from "./task-status-badge"
import { TaskAssignDialog } from "./task-assign-dialog"
import { DeliverableList } from "@/components/deliverables/deliverable-list"
import { taskSpecMarkdownSchema } from "@/lib/utils/validation"
import { lintTaskSpecMarkdown } from "@/lib/tasks/spec-lint"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  dueDate: Date | null
  createdAt: Date
  updatedAt: Date
  project: {
    id: string
    name: string
  } | null
  assignee: {
    id: string
    name: string | null
    email: string
    avatar: string | null
  } | null
  agent: {
    id: string
    name: string
  } | null
  assigneeType: string
  assignmentMode?: string
  functionalAgentType?: string | null
  specQualityScore?: number | null
  riskScore?: number
  riskLevel?: "LOW" | "MEDIUM" | "HIGH"
  riskReasons?: string[]
  specMarkdown?: string | null
  specValidationStatus?: string
  creator: {
    id: string
    name: string | null
    email: string
  } | null
  deliverables: Array<{
    id: string
    name: string
    type: string
    status: string
    submittedAt: Date | null
    reviewedAt: Date | null
    content: string
  }>
  activities: Array<{
    id: string
    action: string
    details: string | null
    createdAt: Date
    user: {
      id: string
      name: string | null
      email: string
    }
  }>
  assignmentLogs: Array<{
    id: string
    action: string
    createdAt: Date
    reason: string | null
    fromType: string | null
    fromAssigneeId: string | null
    fromAgentId: string | null
    toType: string | null
    toAssigneeId: string | null
    toAgentId: string | null
    actor: {
      id: string
      name: string | null
      email: string
    }
  }>
}

interface TaskDetailProps {
  taskId: string
}

interface AgentRunItem {
  executionId: string
  status: "SUCCESS" | "FAILED"
  triggeredAt: string
  triggeredBy: {
    id: string
    name: string | null
    email: string | null
  } | null
  targetAgent: string | null
  runtimeMode: string | null
  deliverableId: string | null
  error: string | null
  idempotencyKey: string | null
}

type SpecStructured = {
  goal: string
  deliverables: string
  requirements: string
  acceptanceCriteria: string
  priority: "HIGH" | "MEDIUM" | "LOW"
  dueDate: string
}

type SourceFileRef = {
  name: string
  url: string
}

function mapAssignmentAction(action: string): string {
  switch (action) {
    case "ASSIGNED":
      return "Assigned"
    case "REASSIGNED":
      return "Reassigned"
    case "CLAIMED":
      return "Claimed by human"
    case "UNASSIGNED":
      return "Unassigned"
    case "SUGGESTED":
      return "AI suggested"
    default:
      return action
  }
}

function formatAssigneeTypeLabel(type: string): string {
  if (type === "FUNCTIONAL_AGENT") return "Agent Queue"
  if (type === "AGENT") return "Agent"
  return "Human"
}

function formatAssignmentModeLabel(mode: string): string {
  if (mode === "AI_SUGGESTED") return "AI Suggested"
  if (mode === "AI_AUTO") return "AI Auto"
  return "Manual"
}

function formatTarget(type: string | null, assigneeId: string | null, agentId: string | null): string {
  if (!type) return "Unassigned"
  if (type === "HUMAN") return assigneeId ? `Human(${assigneeId})` : "Human(awaiting claim)"
  if (type === "AGENT") return agentId ? `Agent(${agentId})` : "Agent(unspecified)"
  if (type === "FUNCTIONAL_AGENT") return "Agent queue"
  return type
}

function parseSourceFileRef(markdown?: string | null): SourceFileRef | null {
  if (!markdown) return null
  const sourceSectionMatch = markdown.match(/##\s+Source File[\s\S]*?(?=\n##\s+|$)/i)
  if (!sourceSectionMatch) return null
  const linkMatch = sourceSectionMatch[0].match(/-\s*File:\s*\[([^\]]+)\]\(([^)]+)\)/i)
  if (!linkMatch) return null
  const name = linkMatch[1]?.trim()
  const url = linkMatch[2]?.trim()
  if (!name || !url) return null
  return { name, url }
}

export function TaskDetail({ taskId }: TaskDetailProps) {
  const router = useRouter()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)
  const [isSuggestingAssign, setIsSuggestingAssign] = useState(false)
  const [isRunningAgent, setIsRunningAgent] = useState(false)
  const [isEditingSpec, setIsEditingSpec] = useState(false)
  const [specDraft, setSpecDraft] = useState("")
  const [specErrors, setSpecErrors] = useState<string[]>([])
  const [specQualityScore, setSpecQualityScore] = useState<number>(0)
  const [specQualityWarnings, setSpecQualityWarnings] = useState<string[]>([])
  const [isSavingSpec, setIsSavingSpec] = useState(false)
  const [agentRuns, setAgentRuns] = useState<AgentRunItem[]>([])
  const [isAgentRunsLoading, setIsAgentRunsLoading] = useState(false)
  const [specStructured, setSpecStructured] = useState<SpecStructured>({
    goal: "",
    deliverables: "",
    requirements: "",
    acceptanceCriteria: "",
    priority: "HIGH",
    dueDate: ""
  })

  useEffect(() => {
    fetchTask()
    fetchCurrentUser()
    fetchAgentRuns()
  }, [taskId])

  const fetchTask = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/tasks/${taskId}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to fetch task"))
      }

      const data = await response.json()
      setTask(data)
      const existingSpec = data.specMarkdown || ""
      setSpecDraft(existingSpec)
      setSpecStructured(parseSpecMarkdown(existingSpec))
      validateSpecDraft(existingSpec)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task")
    } finally {
      setLoading(false)
    }
  }

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch("/api/user/profile")
      if (response.ok) {
        const data = await response.json()
        setCurrentUserId(data.id)
      }
    } catch (err) {
      console.error("Failed to load current user:", err)
    }
  }

  const fetchAgentRuns = async () => {
    setIsAgentRunsLoading(true)
    try {
      const response = await fetch(`/api/tasks/${taskId}/runs?limit=20`)
      if (!response.ok) {
        return
      }
      const data = await response.json()
      setAgentRuns(Array.isArray(data?.runs) ? data.runs : [])
    } catch (err) {
      console.error("Failed to load task agent runs:", err)
    } finally {
      setIsAgentRunsLoading(false)
    }
  }

  const updateStatus = async (newStatus: string) => {
    setIsUpdatingStatus(true)
    setError(null)

    try {
      const response = await fetch(`/api/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to update status"))
      }

      fetchTask()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status")
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const claimTaskSelf = async () => {
    if (!currentUserId || !task) return
    setIsClaiming(true)
    setError(null)

    try {
      const claimPayload =
        task.assigneeType === "FUNCTIONAL_AGENT" && task.functionalAgentType
          ? {
              assigneeType: "FUNCTIONAL_AGENT",
              functionalAgentType: task.functionalAgentType,
              reason: `Claimed from agent queue: ${task.functionalAgentType}`
            }
          : {
              assigneeType: "HUMAN",
              assigneeId: currentUserId,
              reason: "Self-claimed from task detail"
            }

      const response = await fetch(`/api/tasks/${taskId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimPayload)
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to claim task"))
      }

      await fetchTask()
      await fetchAgentRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim task")
    } finally {
      setIsClaiming(false)
    }
  }

  const suggestAndAssign = async () => {
    setIsSuggestingAssign(true)
    setError(null)

    try {
      const suggestRes = await fetch(`/api/tasks/${taskId}/suggest-assignee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topN: 1 })
      })

      if (!suggestRes.ok) {
        const data = await suggestRes.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to suggest assignee"))
      }

      const suggestData = await suggestRes.json()
      const best = suggestData?.suggestions?.[0]
      if (!best) {
        throw new Error("No assignee suggestion available")
      }

      const assignRes = await fetch(`/api/tasks/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeType: best.assigneeType,
          assigneeId: best.assigneeId ?? null,
          agentId: best.agentId ?? null,
          functionalAgentType: best.functionalAgentType ?? null,
          assignmentMode: "AI_SUGGESTED",
          source: "suggestion",
          reason: `Accepted rank #${best.rank} suggestion`
        })
      })

      if (!assignRes.ok) {
        const data = await assignRes.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to assign task"))
      }

      await fetchTask()
      await fetchAgentRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign task")
    } finally {
      setIsSuggestingAssign(false)
    }
  }

  const runAgent = async () => {
    if (!task) return
    setIsRunningAgent(true)
    setError(null)

    try {
      const response = await fetch(`/api/tasks/${task.id}/run-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionNotes: "Triggered from task detail",
          autoSubmit: true
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to run agent"))
      }

      await fetchTask()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent")
    } finally {
      setIsRunningAgent(false)
    }
  }

  const validateSpecDraft = (value: string) => {
    const parsed = taskSpecMarkdownSchema.safeParse(value)
    const lint = lintTaskSpecMarkdown(value)
    setSpecQualityScore(lint.score)
    setSpecQualityWarnings(lint.issues.filter((item) => item.level === "warning").map((item) => item.message).slice(0, 4))
    if (!parsed.success) {
      setSpecErrors(parsed.error.issues.map((issue) => issue.message))
      return false
    }
    setSpecErrors([])
    return true
  }

  const parseSection = (markdown: string, sectionTitle: string): string => {
    const regex = new RegExp(
      `##\\s+${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
      "i"
    )
    const match = markdown.match(regex)
    if (!match?.[1]) return ""
    return match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, ""))
      .join("\n")
  }

  const parseSpecMarkdown = (markdown: string): SpecStructured => {
    const priorityMatch = markdown.match(/##\s+Priority\s*[\s\S]*?-\s*(HIGH|MEDIUM|LOW)/i)
    const dueDateMatch = markdown.match(/##\s+Due Date\s*[\s\S]*?-\s*([^\n]+)/i)

    return {
      goal: parseSection(markdown, "Goal"),
      deliverables: parseSection(markdown, "Deliverables"),
      requirements: parseSection(markdown, "Requirements"),
      acceptanceCriteria: parseSection(markdown, "Acceptance Criteria"),
      priority: (priorityMatch?.[1]?.toUpperCase() as SpecStructured["priority"]) || "HIGH",
      dueDate: dueDateMatch?.[1]?.trim() === "TBD" ? "" : (dueDateMatch?.[1]?.trim() || "")
    }
  }

  const buildSpecMarkdownFromStructured = (data: SpecStructured): string => {
    const toList = (value: string) => {
      const lines = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- (to be filled)"
    }

    return `# TaskSpec

## Goal
${toList(data.goal)}

## Deliverables
${toList(data.deliverables)}

## Requirements
${toList(data.requirements)}

## Acceptance Criteria
${toList(data.acceptanceCriteria)}

## Priority
- ${data.priority}

## Due Date
- ${data.dueDate || "TBD"}`
  }

  const saveTaskSpec = async () => {
    if (!task) return
    setError(null)
    setIsSavingSpec(true)

    try {
      if (!validateSpecDraft(specDraft)) {
        throw new Error("TaskSpec is incomplete. Please fill required sections.")
      }

      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specMarkdown: specDraft,
          specValidationStatus: "VALID"
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to save TaskSpec"))
      }

      setIsEditingSpec(false)
      await fetchTask()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save TaskSpec")
    } finally {
      setIsSavingSpec(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-12 bg-gray-200 rounded w-2/3"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 font-medium mb-2">Failed to load task</p>
          <p className="text-red-500 text-sm mb-4">{error || "Task not found"}</p>
          <Link
            href="/tasks"
            className="inline-block px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Back to Tasks
          </Link>
        </div>
      </div>
    )
  }

  const statusOptions = ["PENDING", "IN_PROGRESS", "REVIEW", "COMPLETED", "CANCELLED"]
  const canRunAgent =
    task.assigneeType !== "HUMAN" &&
    task.status !== "COMPLETED" &&
    task.status !== "CANCELLED"
  const sourceFileRef = parseSourceFileRef(task.specMarkdown)

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>
      </div>

      {error && (
        <div className="mb-6 p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority === 3 ? "URGENT" : task.priority === 2 ? "HIGH" : task.priority === 1 ? "MEDIUM" : "LOW"} />
              {typeof task.riskScore === "number" && (
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    task.riskLevel === "HIGH"
                      ? "bg-red-100 text-red-700"
                      : task.riskLevel === "MEDIUM"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                  title={Array.isArray(task.riskReasons) ? task.riskReasons.join("; ") : undefined}
                >
                  Risk {task.riskLevel || "LOW"} ({task.riskScore})
                </span>
              )}
              {task.project && (
                <Link
                  href={`/projects/${task.project.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {task.project.name}
                </Link>
              )}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{task.title}</h1>
            {task.description && (
              <p className="text-gray-600 mt-2">{task.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={claimTaskSelf}
              disabled={!currentUserId || isClaiming || isSuggestingAssign}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {isClaiming
                ? "Claiming..."
                : task.assigneeType === "FUNCTIONAL_AGENT" && task.functionalAgentType
                  ? `Claim in ${task.functionalAgentType} queue`
                  : "Claim myself"}
            </button>
            <button
              onClick={suggestAndAssign}
              disabled={isSuggestingAssign || isClaiming || isRunningAgent}
              className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSuggestingAssign ? "Assigning..." : "AI suggest & assign"}
            </button>
            <button
              onClick={runAgent}
              disabled={!canRunAgent || isRunningAgent || isClaiming || isSuggestingAssign}
              className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              title={canRunAgent ? "Trigger agent execution" : "Only executable for active agent tasks"}
            >
              {isRunningAgent ? "Running..." : "Run Agent"}
            </button>
            <button
              onClick={() => setIsAssignDialogOpen(true)}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {task.assignee || task.agent ? "Reassign" : "Assign"}
            </button>
          </div>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-6 mt-6 text-sm text-gray-500">
          {task.creator && (
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Created by {task.creator.name || task.creator.email}
            </div>
          )}
          {task.dueDate && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Due {format(new Date(task.dueDate), "PPP")}
            </div>
          )}
          <div>
            Created {format(new Date(task.createdAt), "PPP")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* TaskSpec */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">TaskSpec</h2>
                {task.specValidationStatus && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      task.specValidationStatus === "VALID"
                        ? "bg-green-100 text-green-700"
                        : task.specValidationStatus === "INVALID"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {task.specValidationStatus}
                  </span>
                )}
                {typeof task.specQualityScore === "number" && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                    Quality {task.specQualityScore}/100
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isEditingSpec ? (
                  <>
                    <button
                      onClick={() => {
                        setIsEditingSpec(false)
                        setSpecDraft(task.specMarkdown || "")
                        setSpecErrors([])
                      }}
                      disabled={isSavingSpec}
                      className="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveTaskSpec}
                      disabled={isSavingSpec}
                      className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSavingSpec ? "Saving..." : "Save TaskSpec"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditingSpec(true)}
                    className="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Edit TaskSpec
                  </button>
                )}
              </div>
            </div>

            {sourceFileRef && (
              <div className="mb-4 text-sm">
                <span className="text-gray-500">Source File: </span>
                <Link href={sourceFileRef.url} className="text-blue-600 hover:text-blue-800">
                  {sourceFileRef.name}
                </Link>
              </div>
            )}

            {isEditingSpec ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border border-gray-200 rounded bg-gray-50">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Goal</label>
                    <textarea
                      value={specStructured.goal}
                      onChange={(e) => setSpecStructured({ ...specStructured, goal: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Deliverables</label>
                    <textarea
                      value={specStructured.deliverables}
                      onChange={(e) => setSpecStructured({ ...specStructured, deliverables: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Requirements</label>
                    <textarea
                      value={specStructured.requirements}
                      onChange={(e) => setSpecStructured({ ...specStructured, requirements: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Acceptance Criteria</label>
                    <textarea
                      value={specStructured.acceptanceCriteria}
                      onChange={(e) => setSpecStructured({ ...specStructured, acceptanceCriteria: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      value={specStructured.priority}
                      onChange={(e) =>
                        setSpecStructured({ ...specStructured, priority: e.target.value as SpecStructured["priority"] })
                      }
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Due Date</label>
                    <input
                      value={specStructured.dueDate}
                      onChange={(e) => setSpecStructured({ ...specStructured, dueDate: e.target.value })}
                      placeholder="YYYY-MM-DD"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <button
                      onClick={() => {
                        const nextMarkdown = buildSpecMarkdownFromStructured(specStructured)
                        setSpecDraft(nextMarkdown)
                        validateSpecDraft(nextMarkdown)
                      }}
                      type="button"
                      className="px-3 py-1.5 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      Apply structured fields to markdown
                    </button>
                  </div>
                </div>
                <textarea
                  value={specDraft}
                  onChange={(e) => {
                    setSpecDraft(e.target.value)
                    validateSpecDraft(e.target.value)
                  }}
                  rows={16}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="Write TaskSpec markdown..."
                />
                <div className="text-xs flex items-center gap-2">
                  <span className="font-medium text-gray-700">Quality score:</span>
                  <span
                    className={`px-2 py-0.5 rounded ${
                      specQualityScore >= 80
                        ? "bg-green-100 text-green-700"
                        : specQualityScore >= 60
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {specQualityScore}/100
                  </span>
                </div>
                {specQualityWarnings.length > 0 && (
                  <div className="p-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded space-y-1">
                    {specQualityWarnings.map((msg, idx) => (
                      <div key={`${msg}-${idx}`}>{msg}</div>
                    ))}
                  </div>
                )}
                {specErrors.length > 0 && (
                  <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded space-y-1">
                    {specErrors.map((msg, idx) => (
                      <div key={`${msg}-${idx}`}>{msg}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <pre className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 overflow-auto max-h-96 whitespace-pre-wrap text-sm text-gray-800">
                {task.specMarkdown || "TaskSpec not set yet."}
              </pre>
            )}
          </div>

          {/* Assignee Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Assignment</h2>
            {task.assignee ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                  {(task.assignee.name || task.assignee.email || "U").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {task.assignee.name || task.assignee.email}
                  </p>
                  <p className="text-sm text-gray-500">{task.assignee.email}</p>
                </div>
              </div>
            ) : task.agent ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-white">
                  🤖
                </div>
                <div>
                  <p className="font-medium text-gray-900">{task.agent.name}</p>
                  <p className="text-sm text-gray-500">AI Agent</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Unassigned</p>
                  <p className="text-sm text-gray-500">Assign this task to get started</p>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {task.assignmentMode && (
                <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                  mode: {formatAssignmentModeLabel(task.assignmentMode)}
                </span>
              )}
              {task.functionalAgentType && (
                <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                  queue: {task.functionalAgentType}
                </span>
              )}
              <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                assignee: {formatAssigneeTypeLabel(task.assigneeType)}
              </span>
            </div>
          </div>

          {/* Assignment Timeline */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Assignment log</h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-80 overflow-auto">
              {task.assignmentLogs.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">
                  No assignment logs yet
                </div>
              ) : (
                task.assignmentLogs.map((log) => (
                  <div key={log.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">
                          {mapAssignmentAction(log.action)}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {log.actor.name || log.actor.email}
                        </div>
                        <div className="text-xs text-gray-600 mt-2">
                          {formatTarget(log.fromType, log.fromAssigneeId, log.fromAgentId)}{" "}
                          <span className="text-gray-400">→</span>{" "}
                          {formatTarget(log.toType, log.toAssigneeId, log.toAgentId)}
                        </div>
                        {log.reason && (
                          <div className="text-xs text-gray-500 mt-1">Reason: {log.reason}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {format(new Date(log.createdAt), "PPp")}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Deliverables */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Agent Runs</h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-80 overflow-auto">
              {isAgentRunsLoading ? (
                <div className="p-6 text-sm text-gray-500">Loading agent run history...</div>
              ) : agentRuns.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No agent runs yet</div>
              ) : (
                agentRuns.map((run) => (
                  <div key={run.executionId} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              run.status === "SUCCESS"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {run.status}
                          </span>
                          {run.runtimeMode && (
                            <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                              {run.runtimeMode}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-2">Execution ID: {run.executionId}</div>
                        {run.triggeredBy && (
                          <div className="text-xs text-gray-500 mt-1">
                            Triggered by: {run.triggeredBy.name || run.triggeredBy.email || run.triggeredBy.id}
                          </div>
                        )}
                        {run.targetAgent && (
                          <div className="text-xs text-gray-600 mt-1">Target agent: {run.targetAgent}</div>
                        )}
                        {run.error && (
                          <div className="text-xs text-red-600 mt-1">Error: {run.error}</div>
                        )}
                        {run.deliverableId && (
                          <div className="text-xs text-gray-500 mt-1">Deliverable ID: {run.deliverableId}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {format(new Date(run.triggeredAt), "PPp")}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Deliverables */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Deliverables</h2>
            </div>
            <DeliverableList
              deliverables={task.deliverables}
              taskId={task.id}
              onUpdate={fetchTask}
            />
          </div>

          {/* Activity Log */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Activity</h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
              {task.activities.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No activity yet
                </div>
              ) : (
                task.activities.map((activity) => (
                  <div key={activity.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                        {(activity.user.name || activity.user.email || "U").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {activity.user.name || activity.user.email}
                          </span>
                          <span className="text-gray-300 flex-shrink-0">•</span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(activity.createdAt), "PPp")}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">{activity.action}</p>
                        {activity.details && (
                          <p className="text-xs text-gray-500 mt-1">{activity.details}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Status</h3>
            <div className="space-y-2">
              {statusOptions.map((status) => (
                <button
                  key={status}
                  onClick={() => updateStatus(status)}
                  disabled={isUpdatingStatus}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    task.status === status
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "hover:bg-gray-50 text-gray-700"
                  } ${isUpdatingStatus ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => setIsAssignDialogOpen(true)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 text-gray-700"
              >
                Assign Task
              </button>
              <Link
                href={`/tasks/${task.id}/comments`}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 text-gray-700"
              >
                View Comments
              </Link>
            </div>
          </div>
        </div>
      </div>

      <TaskAssignDialog
        isOpen={isAssignDialogOpen}
        onClose={() => setIsAssignDialogOpen(false)}
        taskId={task.id}
        projectId={task.project?.id}
        onAssigned={fetchTask}
      />
    </div>
  )
}
