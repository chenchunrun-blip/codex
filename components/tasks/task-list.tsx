"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, Filter, ArrowUpDown, Plus } from "lucide-react"
import { TaskCard } from "./task-card"
import { TaskCreateDialog } from "./task-create-dialog"
import { filterTasks } from "@/lib/tasks/filter"
import { groupTasksByAgentQueue } from "@/lib/tasks/group"
import { mapTaskApiErrorFromPayload } from "@/lib/tasks/api-error"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  assignmentMode?: string
  functionalAgentType?: string | null
  assigneeType?: string
  dueDate: Date | null
  createdAt: Date
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
  agent?: {
    id: string
    name: string
  } | null
  deliverables: Array<{
    id: string
    status: string
  }>
  latestAgentRun?: {
    status: "SUCCESS" | "FAILED"
    triggeredAt: string
    executionId: string | null
    error: string | null
  } | null
  specQualityScore?: number | null
  riskScore?: number
  riskLevel?: "LOW" | "MEDIUM" | "HIGH"
  riskReasons?: string[]
}

interface Project {
  id: string
  name: string
}

interface User {
  id: string
  name: string | null
  email: string
}

interface TaskListProps {
  initialTasks?: Task[]
  projectId?: string
  sourceFileId?: string
}

interface BatchActionResultItem {
  taskId: string
  taskTitle: string
  projectId: string | null
  projectName: string | null
  action: "CLAIM" | "AI_ASSIGN"
  success: boolean
  message: string
}

interface BatchArchiveFileItem {
  projectId: string
  projectName: string
  fileId: string
  fileName: string
}

interface BatchProgressState {
  action: "CLAIM" | "AI_ASSIGN"
  total: number
  completed: number
  success: number
  failed: number
}

const BATCH_CONCURRENCY = 3
type BatchResultFilter = "ALL" | "FAILED" | "SUCCESS"
const OPTIONS_FETCH_TIMEOUT_MS = 8000
const OPTIONS_FETCH_MAX_RETRIES = 2

const sanitizeArchiveSegment = (value: string) => {
  return value
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

const buildArchiveFileName = (projectName: string) => {
  const safeProject = sanitizeArchiveSegment(projectName || "project")
  const stamp = new Date()
    .toISOString()
    .replace("T", "-")
    .replace(/[:.]/g, "-")
    .slice(0, 19)
  const nonce = Math.random().toString(36).slice(2, 6)
  return `${safeProject}-task-assignment-batch-report-${stamp}-${nonce}`
}

function getBatchActionLabel(action: "CLAIM" | "AI_ASSIGN") {
  return action === "CLAIM" ? "Bulk claim" : "Bulk AI assign"
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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

function resolveTaskSortFromQuery(params: URLSearchParams): {
  sortBy: "createdAt" | "dueDate" | "priority" | "risk"
  sortOrder: "asc" | "desc"
} {
  const status = params.get("taskStatus") || "all"
  const rawSortBy = params.get("taskSortBy")
  const rawSortOrder = params.get("taskSortOrder")
  const validSortBy: "createdAt" | "dueDate" | "priority" | "risk" | null =
    rawSortBy === "dueDate" || rawSortBy === "priority" || rawSortBy === "risk" || rawSortBy === "createdAt"
      ? rawSortBy
      : null
  if (validSortBy) {
    return {
      sortBy: validSortBy,
      sortOrder: rawSortOrder === "asc" ? "asc" : "desc"
    }
  }
  if (status === "REVIEW") {
    return {
      sortBy: "dueDate",
      sortOrder: "asc"
    }
  }
  return {
    sortBy: "createdAt",
    sortOrder: "desc"
  }
}

export function TaskList({ initialTasks, projectId, sourceFileId }: TaskListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tasks, setTasks] = useState<Task[]>(initialTasks || [])
  const [loading, setLoading] = useState(!initialTasks)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [taskActionLoading, setTaskActionLoading] = useState<Record<string, boolean>>({})
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchActionResultItem[]>([])
  const [isCopyingBatchReport, setIsCopyingBatchReport] = useState(false)
  const [isSavingBatchReport, setIsSavingBatchReport] = useState(false)
  const [batchArchiveFiles, setBatchArchiveFiles] = useState<BatchArchiveFileItem[]>([])
  const [isSavingTasksReport, setIsSavingTasksReport] = useState(false)
  const [tasksReportArchiveFiles, setTasksReportArchiveFiles] = useState<BatchArchiveFileItem[]>([])
  const [batchProgress, setBatchProgress] = useState<BatchProgressState | null>(null)
  const [isBatchCancelRequested, setIsBatchCancelRequested] = useState(false)
  const [batchResultFilter, setBatchResultFilter] = useState<BatchResultFilter>("ALL")
  const [retryingResultTaskId, setRetryingResultTaskId] = useState<string | null>(null)
  const [selectedFailureReason, setSelectedFailureReason] = useState<string | null>(null)
  const [isCopyingFailureReasonList, setIsCopyingFailureReasonList] = useState(false)
  const batchCancelRef = useRef(false)
  const skipInitialFilterResetRef = useRef(true)

  // Filters
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("taskQ") || "")
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("taskStatus") || "all")
  const [priorityFilter, setPriorityFilter] = useState<string>(() => searchParams.get("taskPriority") || "all")
  const [projectFilter, setProjectFilter] = useState<string>(projectId || "all")
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => searchParams.get("taskAssignee") || "all")
  const [assigneeTypeFilter, setAssigneeTypeFilter] = useState<string>(
    () => searchParams.get("taskAssigneeType") || "all"
  )
  const [assignmentModeFilter, setAssignmentModeFilter] = useState<string>(
    () => searchParams.get("taskAssignmentMode") || "all"
  )
  const [riskFilter, setRiskFilter] = useState<string>(() => searchParams.get("taskRisk") || "all")
  const [viewMode, setViewMode] = useState<"list" | "queue">(
    () => (searchParams.get("taskView") === "queue" ? "queue" : "list")
  )
  const [sortBy, setSortBy] = useState<"createdAt" | "dueDate" | "priority" | "risk">(
    () => resolveTaskSortFromQuery(searchParams).sortBy
  )
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    () => resolveTaskSortFromQuery(searchParams).sortOrder
  )
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1, 1, 999))
  const [pageSize, setPageSize] = useState(() =>
    parsePositiveInt(searchParams.get("limit"), 20, 10, 100)
  )
  const [serverPaginationActive, setServerPaginationActive] = useState(false)
  const [serverHasMore, setServerHasMore] = useState(false)
  const [serverTotal, setServerTotal] = useState<number | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])

  useEffect(() => {
    fetchTasks()
  }, [
    projectId,
    sourceFileId,
    searchQuery,
    statusFilter,
    priorityFilter,
    projectFilter,
    assigneeFilter,
    assigneeTypeFilter,
    assignmentModeFilter,
    riskFilter,
    sortBy,
    sortOrder,
    page,
    pageSize
  ])

  useEffect(() => {
    fetchProjects()
    fetchUsers()
    fetchCurrentUser()
  }, [])

  const requestWithRetry = async (url: string, fallback: string) => {
    let response: Response | null = null
    let lastError: unknown = null
    for (let attempt = 0; attempt <= OPTIONS_FETCH_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), OPTIONS_FETCH_TIMEOUT_MS)
      try {
        response = await fetch(url, { signal: controller.signal })
        window.clearTimeout(timeout)
        break
      } catch (err) {
        window.clearTimeout(timeout)
        lastError = err
        if (attempt < OPTIONS_FETCH_MAX_RETRIES) {
          await sleep(300 * (attempt + 1))
        }
      }
    }
    if (!response) {
      throw lastError instanceof Error ? lastError : new Error(fallback)
    }
    return response
  }

  const buildTaskQueryParams = (includePagination: boolean) => {
    const params = new URLSearchParams()
    const effectiveProjectId = projectId || (projectFilter !== "all" ? projectFilter : "")
    if (effectiveProjectId) params.set("projectId", effectiveProjectId)
    if (sourceFileId) params.set("sourceFileId", sourceFileId)
    if (searchQuery) params.set("q", searchQuery)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (assigneeTypeFilter !== "all") params.set("assigneeType", assigneeTypeFilter)
    if (assignmentModeFilter !== "all") params.set("assignmentMode", assignmentModeFilter)
    if (assigneeFilter === "") params.set("assigneeUnassigned", "1")
    else if (assigneeFilter !== "all") params.set("assigneeId", assigneeFilter)
    if (priorityFilter !== "all") {
      const priorityMap: Record<string, string> = { LOW: "0", MEDIUM: "1", HIGH: "2", URGENT: "3" }
      const mapped = priorityMap[priorityFilter]
      if (mapped) params.set("priority", mapped)
    }
    if (sortBy !== "risk") {
      params.set("sortBy", sortBy)
      params.set("sortOrder", sortOrder)
    }
    if (includePagination) {
      params.set("page", String(page))
      params.set("limit", String(pageSize))
    }
    return params
  }

  const fetchTasks = async () => {
    setLoading(true)
    setError(null)

    try {
      const useServerPagination = riskFilter === "all" && sortBy !== "risk"
      const params = buildTaskQueryParams(useServerPagination)

      const response = await requestWithRetry(`/api/tasks?${params}`, "Failed to fetch tasks")
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(mapTaskApiErrorFromPayload(data, "Failed to fetch tasks"))
      }

      const data = await response.json()
      setTasks(data.tasks || [])
      setServerPaginationActive(useServerPagination)
      setServerHasMore(useServerPagination ? Boolean(data?.hasMore) : false)
      setServerTotal(
        useServerPagination && typeof data?.total === "number" ? data.total : null
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks")
    } finally {
      setLoading(false)
    }
  }

  const fetchProjects = async () => {
    try {
      const response = await requestWithRetry("/api/projects", "Failed to load projects")
      if (response.ok) {
        const data = await response.json()
        setProjects(Array.isArray(data) ? data : [])
      } else {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load projects"))
      }
    } catch (err) {
      console.error("Failed to load projects:", err)
      try {
        const cachedProjects = await fetchProjectOptionsCached()
        if (cachedProjects.length > 0) {
          setProjects(cachedProjects)
        }
      } catch {
        // no-op: keep current project options on fallback failure
      }
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await requestWithRetry("/api/users", "Failed to load users")
      if (response.ok) {
        const data = await response.json()
        setUsers(Array.isArray(data) ? data : [])
      } else {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load users"))
      }
    } catch (err) {
      console.error("Failed to load users:", err)
    }
  }

  const fetchCurrentUser = async () => {
    try {
      const response = await requestWithRetry("/api/user/profile", "Failed to load current user")
      if (response.ok) {
        const data = await response.json()
        setCurrentUserId(data.id)
      } else {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load current user"))
      }
    } catch (err) {
      console.error("Failed to load current user:", err)
    }
  }

  const setTaskLoading = (taskId: string, value: boolean) => {
    setTaskActionLoading((prev) => ({ ...prev, [taskId]: value }))
  }

  const getErrorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message) return err.message
    return fallback
  }

  const claimTaskApi = async (task: Task) => {
    if (!currentUserId) {
      throw new Error("Current user is not loaded")
    }

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
            reason: "Self-claimed from task list"
          }

    const response = await fetch(`/api/tasks/${task.id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(claimPayload)
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(mapTaskApiErrorFromPayload(data, "Failed to claim task"))
    }
  }

  const suggestAndAssignTaskApi = async (taskId: string) => {
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
  }

  const claimTask = async (task: Task) => {
    if (!currentUserId) return
    setTaskLoading(task.id, true)
    setActionError(null)
    setActionInfo(null)

    try {
      await claimTaskApi(task)
      await fetchTasks()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to claim task")
    } finally {
      setTaskLoading(task.id, false)
    }
  }

  const suggestAndAssignTask = async (taskId: string) => {
    setTaskLoading(taskId, true)
    setActionError(null)
    setActionInfo(null)

    try {
      await suggestAndAssignTaskApi(taskId)
      await fetchTasks()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to assign task")
    } finally {
      setTaskLoading(taskId, false)
    }
  }

  const toggleTaskSelected = (taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      if (checked) {
        if (prev.includes(taskId)) return prev
        return [...prev, taskId]
      }
      return prev.filter((id) => id !== taskId)
    })
  }

  const selectAllFiltered = (taskIds: string[]) => {
    setSelectedTaskIds(taskIds)
  }

  const handleSelectAllFiltered = async () => {
    setActionError(null)
    try {
      const tasksForSelection = await resolveAllFilteredTasksForActions()
      selectAllFiltered(tasksForSelection.map((task) => task.id))
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to select filtered tasks"))
    }
  }

  const clearSelected = () => {
    setSelectedTaskIds([])
  }

  const runBatchClaim = async () => {
    if (!currentUserId || selectedTaskIds.length === 0) return
    setIsBatchRunning(true)
    setIsBatchCancelRequested(false)
    batchCancelRef.current = false
    setActionError(null)
    setActionInfo(null)
    setBatchArchiveFiles([])
    setBatchProgress(null)
    setBatchResultFilter("ALL")
    setSelectedFailureReason(null)

    try {
      const taskSource = serverPaginationActive ? await resolveAllFilteredTasksForActions() : tasks
      const selectedTasks = taskSource.filter((task) => selectedTaskIds.includes(task.id))
      const { success, failed, canceled, results } = await runBatchActionWithConcurrency(
        selectedTasks,
        "CLAIM",
        (task) => claimTaskApi(task),
        "Claim succeeded",
        "Claim failed"
      )
      setBatchResults(results)
      await fetchTasks()
      clearSelected()
      if (canceled > 0) {
        setActionError(`Bulk claim cancelled: success ${success}, failed ${failed}, not executed ${canceled}`)
      } else if (failed > 0) {
        setActionError(`Bulk claim completed: success ${success}, failed ${failed}`)
      } else {
        setActionInfo(`Bulk claim completed: success ${success}`)
      }
    } finally {
      setIsBatchRunning(false)
      setIsBatchCancelRequested(false)
      batchCancelRef.current = false
    }
  }

  const runBatchSuggestAssign = async () => {
    if (selectedTaskIds.length === 0) return
    setIsBatchRunning(true)
    setIsBatchCancelRequested(false)
    batchCancelRef.current = false
    setActionError(null)
    setActionInfo(null)
    setBatchArchiveFiles([])
    setBatchProgress(null)
    setBatchResultFilter("ALL")
    setSelectedFailureReason(null)

    try {
      const taskSource = serverPaginationActive ? await resolveAllFilteredTasksForActions() : tasks
      const selectedTasks = taskSource.filter((task) => selectedTaskIds.includes(task.id))
      const { success, failed, canceled, results } = await runBatchActionWithConcurrency(
        selectedTasks,
        "AI_ASSIGN",
        (task) => suggestAndAssignTaskApi(task.id),
        "AI assignment succeeded",
        "AI assignment failed"
      )
      setBatchResults(results)
      await fetchTasks()
      clearSelected()
      if (canceled > 0) {
        setActionError(`Bulk AI assign cancelled: success ${success}, failed ${failed}, not executed ${canceled}`)
      } else if (failed > 0) {
        setActionError(`Bulk AI assign completed: success ${success}, failed ${failed}`)
      } else {
        setActionInfo(`Bulk AI assign completed: success ${success}`)
      }
    } finally {
      setIsBatchRunning(false)
      setIsBatchCancelRequested(false)
      batchCancelRef.current = false
    }
  }

  const cancelBatchRun = () => {
    if (!isBatchRunning) return
    setIsBatchCancelRequested(true)
    batchCancelRef.current = true
  }

  const retryFailedBatchItems = async () => {
    const failedItems = batchResults.filter((item) => !item.success)
    if (failedItems.length === 0) return

    setIsBatchRunning(true)
    setIsBatchCancelRequested(false)
    batchCancelRef.current = false
    setActionError(null)
    setActionInfo(null)
    setBatchArchiveFiles([])
    setBatchProgress(null)
    setBatchResultFilter("ALL")
    setSelectedFailureReason(null)

    try {
      const failedMap = new Map<string, BatchActionResultItem>()
      for (const item of failedItems) {
        failedMap.set(item.taskId, item)
      }

      const retryTasks = tasks.filter((task) => failedMap.has(task.id))
      const missingTaskItems = failedItems.filter((item) => !retryTasks.some((t) => t.id === item.taskId))

      const claimTasks = retryTasks.filter((task) => failedMap.get(task.id)?.action === "CLAIM")
      const aiTasks = retryTasks.filter((task) => failedMap.get(task.id)?.action === "AI_ASSIGN")

      let success = 0
      let failed = 0
      let canceled = 0
      const mergedResults: BatchActionResultItem[] = []

      if (claimTasks.length > 0) {
        const result = await runBatchActionWithConcurrency(
          claimTasks,
          "CLAIM",
          (task) => claimTaskApi(task),
          "Claim succeeded",
          "Claim failed"
        )
        success += result.success
        failed += result.failed
        canceled += result.canceled
        mergedResults.push(...result.results)
      }

      if (aiTasks.length > 0 && !batchCancelRef.current) {
        const result = await runBatchActionWithConcurrency(
          aiTasks,
          "AI_ASSIGN",
          (task) => suggestAndAssignTaskApi(task.id),
          "AI assignment succeeded",
          "AI assignment failed"
        )
        success += result.success
        failed += result.failed
        canceled += result.canceled
        mergedResults.push(...result.results)
      }

      if (missingTaskItems.length > 0) {
        failed += missingTaskItems.length
        mergedResults.push(
          ...missingTaskItems.map((item) => ({
            ...item,
            success: false as const,
            message: "Task is not in current list and cannot be retried"
          }))
        )
      }

      setBatchResults(mergedResults)
      await fetchTasks()

      if (canceled > 0) {
        setActionError(`Retry cancelled: success ${success}, failed ${failed}, not executed ${canceled}`)
      } else if (failed > 0) {
        setActionError(`Retry completed: success ${success}, failed ${failed}`)
      } else {
        setActionInfo(`Retry completed: success ${success}`)
      }
    } finally {
      setIsBatchRunning(false)
      setIsBatchCancelRequested(false)
      batchCancelRef.current = false
    }
  }

  const retrySingleBatchItem = async (item: BatchActionResultItem) => {
    if (isBatchRunning) return
    const task = tasks.find((t) => t.id === item.taskId)
    if (!task) {
      setBatchResults((prev) =>
        prev.map((it) =>
          it.taskId === item.taskId
            ? { ...it, success: false, message: "Task is not in current list and cannot be retried" }
            : it
        )
      )
      return
    }

    setRetryingResultTaskId(item.taskId)
    setActionError(null)
    setActionInfo(null)
    setBatchArchiveFiles([])

    try {
      if (item.action === "CLAIM") {
        await claimTaskApi(task)
      } else {
        await suggestAndAssignTaskApi(task.id)
      }

      setBatchResults((prev) =>
        prev.map((it) =>
          it.taskId === item.taskId
            ? { ...it, success: true, message: item.action === "CLAIM" ? "Claim succeeded" : "AI assignment succeeded" }
            : it
        )
      )
      setActionInfo(`Single retry succeeded: ${task.title}`)
      await fetchTasks()
    } catch (err) {
      const message = getErrorMessage(err, item.action === "CLAIM" ? "Claim failed" : "AI assignment failed")
      setBatchResults((prev) =>
        prev.map((it) =>
          it.taskId === item.taskId
            ? { ...it, success: false, message }
            : it
        )
      )
      setActionError(`Single retry failed: ${task.title}`)
    } finally {
      setRetryingResultTaskId(null)
    }
  }

  const runBatchActionWithConcurrency = async (
    selectedTasks: Task[],
    action: BatchActionResultItem["action"],
    runner: (task: Task) => Promise<void>,
    successMessage: string,
    failureMessage: string
  ) => {
    const results = new Array<BatchActionResultItem>(selectedTasks.length)
    let cursor = 0
    let success = 0
    let failed = 0
    let completed = 0

    setBatchProgress({
      action,
      total: selectedTasks.length,
      completed: 0,
      success: 0,
      failed: 0
    })

    const worker = async () => {
      while (true) {
        if (batchCancelRef.current) break
        const index = cursor
        cursor += 1
        if (index >= selectedTasks.length) break

        const task = selectedTasks[index]
        try {
          await runner(task)
          success += 1
          results[index] = {
            taskId: task.id,
            taskTitle: task.title,
            projectId: task.project?.id ?? null,
            projectName: task.project?.name ?? null,
            action,
            success: true,
            message: successMessage
          }
        } catch (err) {
          failed += 1
          results[index] = {
            taskId: task.id,
            taskTitle: task.title,
            projectId: task.project?.id ?? null,
            projectName: task.project?.name ?? null,
            action,
            success: false,
            message: getErrorMessage(err, failureMessage)
          }
        } finally {
          completed += 1
          setBatchProgress({
            action,
            total: selectedTasks.length,
            completed,
            success,
            failed
          })
        }
      }
    }

    const workerCount = Math.min(BATCH_CONCURRENCY, selectedTasks.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    const finalizedResults = results.filter((item): item is BatchActionResultItem => Boolean(item))
    const canceled = Math.max(selectedTasks.length - completed, 0)

    return { success, failed, canceled, results: finalizedResults }
  }

  const buildBatchResultsMarkdown = (
    items: BatchActionResultItem[],
    options?: { title?: string; projectName?: string }
  ) => {
    const successCount = items.filter((item) => item.success).length
    const failedCount = items.length - successCount
    const now = new Date().toISOString()
    const title = options?.title ?? "Batch Assignment Report"
    const projectLine = options?.projectName ? `- Project: ${options.projectName}\n` : ""
    const rows = items
      .map((item, index) => {
        const status = item.success ? "SUCCESS" : "FAILED"
        return `${index + 1}. [${item.action}] [${status}] ${item.taskTitle} (${item.taskId}) - ${item.message}`
      })
      .join("\n")

    return `# ${title}

- GeneratedAt: ${now}
${projectLine}- Total: ${items.length}
- Success: ${successCount}
- Failed: ${failedCount}

## Details
${rows}
`
  }

  const exportBatchResultsAsMarkdown = async () => {
    if (batchResults.length === 0) return
    setIsCopyingBatchReport(true)
    setActionError(null)
    setActionInfo(null)

    try {
      const markdown = buildBatchResultsMarkdown(batchResults)

      await navigator.clipboard.writeText(markdown)
      setActionInfo("Batch results markdown copied to clipboard")
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to copy markdown, check browser permission"))
    } finally {
      setIsCopyingBatchReport(false)
    }
  }

  const saveBatchResultsToArchive = async () => {
    if (batchResults.length === 0) return
    setIsSavingBatchReport(true)
    setActionError(null)
    setActionInfo(null)
    setBatchArchiveFiles([])

    try {
      const groupedByProject = new Map<string, { projectName: string; items: BatchActionResultItem[] }>()

      for (const item of batchResults) {
        if (!item.projectId || !item.projectName) continue
        if (!groupedByProject.has(item.projectId)) {
          groupedByProject.set(item.projectId, {
            projectName: item.projectName,
            items: []
          })
        }
        groupedByProject.get(item.projectId)!.items.push(item)
      }

      if (groupedByProject.size === 0) {
        throw new Error("No archivable project information found")
      }

      let success = 0
      let failed = 0
      const createdFiles: BatchArchiveFileItem[] = []

      for (const [projectId, group] of groupedByProject.entries()) {
        const reportMarkdown = buildBatchResultsMarkdown(group.items, {
          title: "Task Assignment Batch Report",
          projectName: group.projectName
        })
        const fileName = buildArchiveFileName(group.projectName)

        const response = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            name: fileName,
            content: reportMarkdown
          })
        })

        if (response.ok) {
          const file = await response.json()
          success += 1
          createdFiles.push({
            projectId,
            projectName: group.projectName,
            fileId: file.id,
            fileName: file.name || fileName
          })
        } else {
          failed += 1
        }
      }
      setBatchArchiveFiles(createdFiles)

      if (failed > 0) {
        setActionError(`Batch archive completed: success ${success}, failed ${failed}`)
      } else {
        setActionInfo(`Batch archive completed: success ${success}`)
      }
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to save archive"))
    } finally {
      setIsSavingBatchReport(false)
    }
  }

  const copySelectedFailureReasonTasks = async () => {
    if (!selectedFailureReason) return
    setIsCopyingFailureReasonList(true)
    setActionError(null)
    setActionInfo(null)

    try {
      const items = batchResults.filter(
        (item) => !item.success && item.message === selectedFailureReason
      )
      const now = new Date().toISOString()
      const rows = items
        .map((item, index) => `${index + 1}. [${item.action}] ${item.taskTitle} (${item.taskId})`)
        .join("\n")

      const markdown = `# Failure Reason Task List

- GeneratedAt: ${now}
- Reason: ${selectedFailureReason}
- Count: ${items.length}

## Tasks
${rows}
`

      await navigator.clipboard.writeText(markdown)
      setActionInfo("Failure-reason task list copied to clipboard")
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to copy failure-reason task list"))
    } finally {
      setIsCopyingFailureReasonList(false)
    }
  }

  const resolveAllFilteredTasksForActions = async () => {
    if (!serverPaginationActive) return filteredTasks

    const params = buildTaskQueryParams(false)
    const response = await requestWithRetry(`/api/tasks?${params}`, "Failed to fetch tasks")
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(mapTaskApiErrorFromPayload(data, "Failed to fetch tasks"))
    }
    const data = await response.json()
    return applyClientFilterAndSort(Array.isArray(data?.tasks) ? data.tasks : [])
  }

  const exportFilteredTasksReport = async () => {
    setActionError(null)
    setActionInfo(null)
    try {
      const tasksForReport = await resolveAllFilteredTasksForActions()
      const lines: string[] = []
      lines.push("# Tasks Report")
      lines.push("")
      lines.push(`- Generated At: ${new Date().toISOString()}`)
      lines.push(`- Total Tasks: ${tasksForReport.length}`)
      lines.push("")
      lines.push("| Task | Project | Status | Priority | Assignee Type | Assignee | Risk | Due Date |")
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |")
      for (const task of tasksForReport) {
        const assigneeLabel =
          task.assigneeType === "FUNCTIONAL_AGENT"
            ? task.functionalAgentType || "QUEUE"
            : task.assignee?.name || task.assignee?.email || task.agent?.name || "Unassigned"
        const priorityLabel =
          task.priority >= 3 ? "URGENT" : task.priority === 2 ? "HIGH" : task.priority === 1 ? "MEDIUM" : "LOW"
        lines.push(
          `| ${task.title.replace(/\|/g, "\\|")} | ${(task.project?.name || "-").replace(/\|/g, "\\|")} | ${task.status} | ${priorityLabel} | ${task.assigneeType || "-"} | ${assigneeLabel.replace(/\|/g, "\\|")} | ${task.riskLevel || "LOW"} (${task.riskScore || 0}) | ${task.dueDate ? new Date(task.dueDate).toISOString() : "-"} |`
        )
      }
      const markdown = lines.join("\n")
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      anchor.href = url
      anchor.download = `tasks-report-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to export tasks report"))
    }
  }

  const saveFilteredTasksReportToArchive = async () => {
    setIsSavingTasksReport(true)
    setActionError(null)
    setActionInfo(null)
    setTasksReportArchiveFiles([])

    try {
      const tasksForReport = await resolveAllFilteredTasksForActions()
      if (tasksForReport.length === 0) return
      const groupedByProject = new Map<string, { projectName: string; items: Task[] }>()
      for (const task of tasksForReport) {
        if (!task.project?.id || !task.project?.name) continue
        if (!groupedByProject.has(task.project.id)) {
          groupedByProject.set(task.project.id, {
            projectName: task.project.name,
            items: []
          })
        }
        groupedByProject.get(task.project.id)!.items.push(task)
      }
      if (groupedByProject.size === 0) {
        throw new Error("No project context found for current filtered tasks")
      }

      let success = 0
      let failed = 0
      const createdFiles: BatchArchiveFileItem[] = []

      for (const [projectId, group] of groupedByProject.entries()) {
        const lines: string[] = []
        lines.push(`# Filtered Tasks Report: ${group.projectName}`)
        lines.push("")
        lines.push(`- GeneratedAt: ${new Date().toISOString()}`)
        lines.push(`- Total: ${group.items.length}`)
        lines.push("")
        lines.push("| Task | Status | Priority | Assignee Type | Assignee | Risk | Due Date |")
        lines.push("| --- | --- | --- | --- | --- | --- | --- |")
        for (const task of group.items) {
          const assigneeLabel =
            task.assigneeType === "FUNCTIONAL_AGENT"
              ? task.functionalAgentType || "QUEUE"
              : task.assignee?.name || task.assignee?.email || task.agent?.name || "Unassigned"
          const priorityLabel =
            task.priority >= 3 ? "URGENT" : task.priority === 2 ? "HIGH" : task.priority === 1 ? "MEDIUM" : "LOW"
          lines.push(
            `| ${task.title.replace(/\|/g, "\\|")} | ${task.status} | ${priorityLabel} | ${task.assigneeType || "-"} | ${assigneeLabel.replace(/\|/g, "\\|")} | ${task.riskLevel || "LOW"} (${task.riskScore || 0}) | ${task.dueDate ? new Date(task.dueDate).toISOString() : "-"} |`
          )
        }
        const fileName = buildArchiveFileName(`${group.projectName}-filtered-tasks-report`)
        const response = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            name: fileName,
            content: lines.join("\n")
          })
        })
        if (response.ok) {
          const file = await response.json()
          success += 1
          createdFiles.push({
            projectId,
            projectName: group.projectName,
            fileId: file.id,
            fileName: file.name || fileName
          })
        } else {
          failed += 1
        }
      }

      setTasksReportArchiveFiles(createdFiles)
      if (failed > 0) {
        setActionError(`Tasks report archive completed: success ${success}, failed ${failed}`)
      } else {
        setActionInfo(`Tasks report archive completed: success ${success}`)
      }
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to save tasks report"))
    } finally {
      setIsSavingTasksReport(false)
    }
  }

  const applyClientFilterAndSort = (items: Task[]) => {
    return filterTasks(items, {
      searchQuery,
      statusFilter,
      priorityFilter,
      projectFilter,
      assigneeFilter,
      assigneeTypeFilter,
      assignmentModeFilter,
      riskFilter
    }).sort((a, b) => {
      let comparison = 0

      if (sortBy === "priority") {
        const priorityOrder: Record<number, number> = { 3: 4, 2: 3, 1: 2, 0: 1 }
        comparison = priorityOrder[a.priority] - priorityOrder[b.priority]
      } else if (sortBy === "risk") {
        comparison = (a.riskScore || 0) - (b.riskScore || 0)
      } else if (sortBy === "dueDate") {
        if (!a.dueDate) comparison = 1
        else if (!b.dueDate) comparison = -1
        else comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      } else {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }

      return sortOrder === "asc" ? comparison : -comparison
    })
  }

  const filteredTasks = applyClientFilterAndSort(tasks)
  const reviewTasks = filteredTasks.filter((task) => task.status === "REVIEW")
  const now = Date.now()
  const reviewOverdueCount = reviewTasks.filter((task) => {
    if (!task.dueDate) return false
    return new Date(task.dueDate).getTime() < now
  }).length
  const reviewDueIn24hCount = reviewTasks.filter((task) => {
    if (!task.dueDate) return false
    const due = new Date(task.dueDate).getTime()
    return due >= now && due <= now + 24 * 60 * 60 * 1000
  }).length
  const reviewNoDueDateCount = reviewTasks.filter((task) => !task.dueDate).length

  const filteredBatchResults = batchResults.filter((item) => {
    if (selectedFailureReason && (item.success || item.message !== selectedFailureReason)) return false
    if (batchResultFilter === "FAILED") return !item.success
    if (batchResultFilter === "SUCCESS") return item.success
    return true
  })

  const batchFailureSummary = Array.from(
    batchResults
      .filter((item) => !item.success)
      .reduce((acc, item) => {
        const reason = item.message || "Unknown failure reason"
        acc.set(reason, (acc.get(reason) || 0) + 1)
        return acc
      }, new Map<string, number>())
      .entries()
  ).sort((a, b) => b[1] - a[1])

  const lowSpecQualityTasks = filteredTasks.filter(
    (task) => typeof task.specQualityScore === "number" && task.specQualityScore < 60
  )
  const highRiskTasks = filteredTasks.filter((task) => task.riskLevel === "HIGH")
  const pagedTasks = serverPaginationActive
    ? filteredTasks
    : filteredTasks.slice((page - 1) * pageSize, page * pageSize)
  const hasMoreTasks = serverPaginationActive ? serverHasMore : page * pageSize < filteredTasks.length

  useEffect(() => {
    const nextPage = parsePositiveInt(searchParams.get("page"), 1, 1, 999)
    const nextPageSize = parsePositiveInt(searchParams.get("limit"), 20, 10, 100)
    const nextSearchQuery = searchParams.get("taskQ") || ""
    const nextStatusFilter = searchParams.get("taskStatus") || "all"
    const nextPriorityFilter = searchParams.get("taskPriority") || "all"
    const nextAssigneeFilter = searchParams.get("taskAssignee") || "all"
    const nextAssigneeTypeFilter = searchParams.get("taskAssigneeType") || "all"
    const nextAssignmentModeFilter = searchParams.get("taskAssignmentMode") || "all"
    const nextRiskFilter = searchParams.get("taskRisk") || "all"
    const nextViewMode = searchParams.get("taskView") === "queue" ? "queue" : "list"
    const nextSort = resolveTaskSortFromQuery(searchParams)
    const nextSortBy = nextSort.sortBy
    const nextSortOrder = nextSort.sortOrder

    setPage((current) => (current === nextPage ? current : nextPage))
    setPageSize((current) => (current === nextPageSize ? current : nextPageSize))
    setSearchQuery((current) => (current === nextSearchQuery ? current : nextSearchQuery))
    setStatusFilter((current) => (current === nextStatusFilter ? current : nextStatusFilter))
    setPriorityFilter((current) => (current === nextPriorityFilter ? current : nextPriorityFilter))
    setAssigneeFilter((current) => (current === nextAssigneeFilter ? current : nextAssigneeFilter))
    setAssigneeTypeFilter((current) =>
      current === nextAssigneeTypeFilter ? current : nextAssigneeTypeFilter
    )
    setAssignmentModeFilter((current) =>
      current === nextAssignmentModeFilter ? current : nextAssignmentModeFilter
    )
    setRiskFilter((current) => (current === nextRiskFilter ? current : nextRiskFilter))
    setViewMode((current) => (current === nextViewMode ? current : nextViewMode))
    setSortBy((current) => (current === nextSortBy ? current : nextSortBy))
    setSortOrder((current) => (current === nextSortOrder ? current : nextSortOrder))
  }, [searchParams])

  useEffect(() => {
    if (skipInitialFilterResetRef.current) {
      skipInitialFilterResetRef.current = false
      return
    }
    setPage(1)
  }, [
    searchQuery,
    statusFilter,
    priorityFilter,
    projectFilter,
    assigneeFilter,
    assigneeTypeFilter,
    assignmentModeFilter,
    riskFilter,
    sortBy,
    sortOrder,
    viewMode
  ])

  useEffect(() => {
    if (loading) return
    const totalForPaging =
      serverPaginationActive && typeof serverTotal === "number" ? serverTotal : filteredTasks.length
    const maxPage = Math.max(1, Math.ceil(totalForPaging / pageSize))
    if (page > maxPage) {
      setPage(maxPage)
    }
  }, [filteredTasks.length, loading, page, pageSize, serverPaginationActive, serverTotal])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())
    if (page > 1) nextParams.set("page", String(page))
    else nextParams.delete("page")
    if (pageSize !== 20) nextParams.set("limit", String(pageSize))
    else nextParams.delete("limit")
    if (searchQuery) nextParams.set("taskQ", searchQuery)
    else nextParams.delete("taskQ")
    if (statusFilter !== "all") nextParams.set("taskStatus", statusFilter)
    else nextParams.delete("taskStatus")
    if (priorityFilter !== "all") nextParams.set("taskPriority", priorityFilter)
    else nextParams.delete("taskPriority")
    if (assigneeFilter !== "all") nextParams.set("taskAssignee", assigneeFilter)
    else nextParams.delete("taskAssignee")
    if (assigneeTypeFilter !== "all") nextParams.set("taskAssigneeType", assigneeTypeFilter)
    else nextParams.delete("taskAssigneeType")
    if (assignmentModeFilter !== "all") nextParams.set("taskAssignmentMode", assignmentModeFilter)
    else nextParams.delete("taskAssignmentMode")
    if (riskFilter !== "all") nextParams.set("taskRisk", riskFilter)
    else nextParams.delete("taskRisk")
    if (sortBy !== "createdAt") nextParams.set("taskSortBy", sortBy)
    else nextParams.delete("taskSortBy")
    if (sortOrder !== "desc") nextParams.set("taskSortOrder", sortOrder)
    else nextParams.delete("taskSortOrder")
    if (viewMode !== "list") nextParams.set("taskView", viewMode)
    else nextParams.delete("taskView")

    const currentQuery = searchParams.toString()
    const nextQuery = nextParams.toString()
    if (currentQuery === nextQuery) return
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [
    page,
    pageSize,
    searchQuery,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    assigneeTypeFilter,
    assignmentModeFilter,
    riskFilter,
    sortBy,
    sortOrder,
    viewMode,
    pathname,
    router,
    searchParams
  ])

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("desc")
    }
  }

  const renderTaskActionCard = (task: Task) => (
    <div key={task.id} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={selectedTaskIds.includes(task.id)}
            onChange={(e) => toggleTaskSelected(task.id, e.target.checked)}
            disabled={isBatchRunning || !!taskActionLoading[task.id]}
            className="rounded border-gray-300"
          />
          Select
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => claimTask(task)}
            disabled={!currentUserId || !!taskActionLoading[task.id] || isBatchRunning}
            className="px-3 py-1.5 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {taskActionLoading[task.id]
              ? "Processing..."
              : task.assigneeType === "FUNCTIONAL_AGENT" && task.functionalAgentType
                ? `Claim in ${task.functionalAgentType} queue`
                : "Claim myself"}
          </button>
          <button
            onClick={() => suggestAndAssignTask(task.id)}
            disabled={!!taskActionLoading[task.id] || isBatchRunning}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {taskActionLoading[task.id] ? "Processing..." : "AI suggest & assign"}
          </button>
        </div>
      </div>
      <TaskCard task={task} />
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/3 mb-3"></div>
            <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-600 font-medium mb-2">Failed to load tasks</p>
        <p className="text-red-500 text-sm mb-4">{error}</p>
        <button
          onClick={fetchTasks}
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
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">
            {serverPaginationActive && typeof serverTotal === "number" ? serverTotal : filteredTasks.length}{" "}
            {(serverPaginationActive && typeof serverTotal === "number" ? serverTotal : filteredTasks.length) === 1
              ? "task"
              : "tasks"}{" "}
            · Showing {pagedTasks.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 text-xs rounded ${
                viewMode === "list" ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              List view
            </button>
            <button
              onClick={() => setViewMode("queue")}
              className={`px-3 py-1.5 text-xs rounded ${
                viewMode === "queue" ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              Agent queue view
            </button>
          </div>
          <button
            type="button"
            onClick={exportFilteredTasksReport}
            disabled={filteredTasks.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Export Tasks
          </button>
          <button
            type="button"
            onClick={saveFilteredTasksReportToArchive}
            disabled={filteredTasks.length === 0 || isSavingTasksReport}
            className="inline-flex items-center gap-2 px-3 py-2 border border-blue-300 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-100 disabled:opacity-50 transition-colors"
          >
            {isSavingTasksReport ? "Saving..." : "Save Report"}
          </button>
          <button
            onClick={() => setIsCreateDialogOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {actionError}
        </div>
      )}
      {actionInfo && (
        <div className="mb-4 p-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg">
          {actionInfo}
        </div>
      )}
      {lowSpecQualityTasks.length > 0 && (
        <div className="mb-4 p-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
          {lowSpecQualityTasks.length} task{lowSpecQualityTasks.length > 1 ? "s" : ""} have low TaskSpec quality score (&lt;60). Review Goal/Deliverables/Requirements/Acceptance Criteria for placeholders or missing detail.
        </div>
      )}
      {highRiskTasks.length > 0 && (
        <div className="mb-4 p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
          {highRiskTasks.length} high-risk task{highRiskTasks.length > 1 ? "s are" : " is"} detected. Prioritize due date, failed run, and agent availability risks.
        </div>
      )}
      {statusFilter === "REVIEW" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-900">Review Priority Summary</div>
              <div className="mt-1 text-xs text-amber-800">
                Overdue: {reviewOverdueCount} · Due in 24h: {reviewDueIn24hCount} · No due date: {reviewNoDueDateCount}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="Sort review queue by due date"
                onClick={() => {
                  setSortBy("dueDate")
                  setSortOrder("asc")
                }}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                Sort by Due Date
              </button>
              <button
                type="button"
                aria-label="Filter review queue to high risk tasks"
                onClick={() => {
                  setRiskFilter("HIGH")
                  setSortBy("dueDate")
                  setSortOrder("asc")
                }}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                High Risk Only
              </button>
              <button
                type="button"
                aria-label="Reset review queue filters"
                onClick={() => {
                  setSearchQuery("")
                  setPriorityFilter("all")
                  setAssigneeFilter("all")
                  setAssigneeTypeFilter("all")
                  setAssignmentModeFilter("all")
                  setRiskFilter("all")
                  setSortBy("dueDate")
                  setSortOrder("asc")
                  setPage(1)
                }}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                Reset Review Filters
              </button>
            </div>
          </div>
        </div>
      )}
      {tasksReportArchiveFiles.length > 0 && (
        <div className="mb-4 p-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg">
          Saved tasks report files:
          <div className="mt-1 flex flex-col gap-1">
            {tasksReportArchiveFiles.map((item) => (
              <Link
                key={item.fileId}
                href={`/editor/${item.fileId}`}
                className="underline decoration-dotted hover:decoration-solid"
              >
                {item.projectName}: {item.fileName}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-9 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="REVIEW">In Review</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          {/* Project Filter */}
          <div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              disabled={!!projectId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-50"
            >
              <option value="all">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee Filter */}
          <div>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Assignees</option>
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee Type Filter */}
          <div>
            <select
              value={assigneeTypeFilter}
              onChange={(e) => setAssigneeTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Assignee Types</option>
              <option value="HUMAN">Human</option>
              <option value="AGENT">Agent</option>
              <option value="FUNCTIONAL_AGENT">Agent Queue</option>
            </select>
          </div>

          {/* Assignment Mode Filter */}
          <div>
            <select
              value={assignmentModeFilter}
              onChange={(e) => setAssignmentModeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Modes</option>
              <option value="MANUAL">Manual</option>
              <option value="AI_SUGGESTED">AI Suggested</option>
              <option value="AI_AUTO">AI Auto</option>
            </select>
          </div>

          {/* Risk Filter */}
          <div>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Risk Levels</option>
              <option value="HIGH">High Risk</option>
              <option value="MEDIUM">Medium Risk</option>
              <option value="LOW">Low Risk</option>
            </select>
          </div>
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-200">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-500">Sort by:</span>
          <div className="flex gap-1">
            <button
              onClick={() => toggleSort("createdAt")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                sortBy === "createdAt"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Created {sortBy === "createdAt" && (sortOrder === "asc" ? "↑" : "↓")}
            </button>
            <button
              onClick={() => toggleSort("dueDate")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                sortBy === "dueDate"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Due Date {sortBy === "dueDate" && (sortOrder === "asc" ? "↑" : "↓")}
            </button>
            <button
              onClick={() => toggleSort("priority")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                sortBy === "priority"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Priority {sortBy === "priority" && (sortOrder === "asc" ? "↑" : "↓")}
            </button>
            <button
              onClick={() => toggleSort("risk")}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                sortBy === "risk"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Risk {sortBy === "risk" && (sortOrder === "asc" ? "↑" : "↓")}
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">Page {page}</span>
            <button
              type="button"
              onClick={() => setPage((current) => (hasMoreTasks ? current + 1 : current))}
              disabled={!hasMoreTasks}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks found</h3>
          <p className="text-gray-500 mb-6">
            {searchQuery || statusFilter !== "all" || priorityFilter !== "all" || riskFilter !== "all"
              ? "Try adjusting your filters or search query"
              : "Get started by creating your first task"}
          </p>
          {!searchQuery && statusFilter === "all" && priorityFilter === "all" && riskFilter === "all" && (
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Task
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">Selected {selectedTaskIds.length} items</span>
            <button
              onClick={() => {
                handleSelectAllFiltered().catch(() => undefined)
              }}
              disabled={isBatchRunning}
              className="px-2.5 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              Select all filtered
            </button>
            <button
              onClick={clearSelected}
              disabled={selectedTaskIds.length === 0 || isBatchRunning}
              className="px-2.5 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              Clear selection
            </button>
            <button
              onClick={runBatchClaim}
              disabled={!currentUserId || selectedTaskIds.length === 0 || isBatchRunning}
              className="px-2.5 py-1 text-xs rounded bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
            >
              {isBatchRunning ? "Processing..." : "Bulk claim"}
            </button>
            <button
              onClick={runBatchSuggestAssign}
              disabled={selectedTaskIds.length === 0 || isBatchRunning}
              className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isBatchRunning ? "Processing..." : "Bulk AI assign"}
            </button>
            <button
              onClick={cancelBatchRun}
              disabled={!isBatchRunning}
              className="px-2.5 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {isBatchCancelRequested ? "Cancelling..." : "Cancel run"}
            </button>
          </div>

          {batchProgress && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-4">
              <div className="flex items-center justify-between text-xs text-gray-700 mb-2">
                <span>{getBatchActionLabel(batchProgress.action)} progress</span>
                <span className="inline-flex items-center gap-2">
                  {batchProgress.completed}/{batchProgress.total} · Success {batchProgress.success} · Failed {batchProgress.failed}
                  {isBatchCancelRequested && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Cancelling...</span>
                  )}
                </span>
              </div>
              <div className="w-full h-2 rounded bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{
                    width: `${batchProgress.total === 0 ? 0 : (batchProgress.completed / batchProgress.total) * 100}%`
                  }}
                />
              </div>
            </div>
          )}

          {batchResults.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Batch execution results</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={retryFailedBatchItems}
                    disabled={isBatchRunning || batchResults.every((item) => item.success)}
                    className="px-2 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    Retry failed items
                  </button>
                  <button
                    onClick={exportBatchResultsAsMarkdown}
                    disabled={isCopyingBatchReport || isSavingBatchReport}
                    className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isCopyingBatchReport ? "Copying..." : "Copy Markdown"}
                  </button>
                  <button
                    onClick={saveBatchResultsToArchive}
                    disabled={isSavingBatchReport || isCopyingBatchReport}
                    className="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSavingBatchReport ? "Archiving..." : "Save to archive"}
                  </button>
                  <button
                    onClick={() => {
                      setBatchResults([])
                      setBatchArchiveFiles([])
                      setBatchProgress(null)
                      setSelectedFailureReason(null)
                    }}
                    className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Clear results
                  </button>
                </div>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Filter</span>
                <button
                  onClick={() => {
                    setBatchResultFilter("ALL")
                    setSelectedFailureReason(null)
                  }}
                  className={`px-2 py-1 text-xs rounded ${
                    batchResultFilter === "ALL" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  All ({batchResults.length})
                </button>
                <button
                  onClick={() => setBatchResultFilter("FAILED")}
                  className={`px-2 py-1 text-xs rounded ${
                    batchResultFilter === "FAILED" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"
                  }`}
                >
                  Failed only ({batchResults.filter((item) => !item.success).length})
                </button>
                <button
                  onClick={() => {
                    setBatchResultFilter("SUCCESS")
                    setSelectedFailureReason(null)
                  }}
                  className={`px-2 py-1 text-xs rounded ${
                    batchResultFilter === "SUCCESS" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  Succeeded only ({batchResults.filter((item) => item.success).length})
                </button>
              </div>
              {batchFailureSummary.length > 0 && (
                <div className="mb-2 p-2 rounded border border-red-100 bg-red-50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-medium text-red-700">Failure reason summary</div>
                    <div className="flex items-center gap-2">
                      {selectedFailureReason && (
                        <button
                          onClick={copySelectedFailureReasonTasks}
                          disabled={isCopyingFailureReasonList}
                          className="px-2 py-0.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {isCopyingFailureReasonList ? "Copying..." : "Copy this reason list"}
                        </button>
                      )}
                      {selectedFailureReason && (
                        <button
                          onClick={() => setSelectedFailureReason(null)}
                          className="px-2 py-0.5 text-xs rounded bg-white border border-red-200 text-red-700 hover:bg-red-100"
                        >
                          Clear reason filter
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {batchFailureSummary.map(([reason, count]) => (
                      <button
                        key={`${reason}-${count}`}
                        onClick={() => {
                          setBatchResultFilter("FAILED")
                          setSelectedFailureReason((prev) => (prev === reason ? null : reason))
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${
                          selectedFailureReason === reason
                            ? "bg-red-600 border-red-600 text-white"
                            : "bg-white border-red-200 text-red-700 hover:bg-red-100"
                        }`}
                        title={reason}
                      >
                        <span className="max-w-72 truncate">{reason}</span>
                        <span
                          className={`px-1 rounded ${
                            selectedFailureReason === reason ? "bg-white/20 text-white" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {batchArchiveFiles.length > 0 && (
                <div className="mb-2 p-2 rounded border border-emerald-100 bg-emerald-50">
                  <div className="text-xs font-medium text-emerald-700 mb-1">Archive files</div>
                  <div className="flex flex-wrap gap-2">
                    {batchArchiveFiles.map((file) => (
                      <Link
                        key={file.fileId}
                        href={`/editor/${file.fileId}`}
                        className="inline-flex items-center px-2 py-1 text-xs rounded bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      >
                        {file.projectName}: {file.fileName}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <div className="max-h-56 overflow-auto divide-y divide-gray-100 border border-gray-100 rounded">
                {filteredBatchResults.map((item) => (
                  <div key={`${item.action}-${item.taskId}`} className="px-3 py-2 text-xs flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-gray-900 font-medium truncate">
                        [{item.action}] {item.taskTitle}
                      </div>
                      <div className={item.success ? "text-green-700" : "text-red-600"}>
                        {item.message}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!item.success && (
                        <button
                          onClick={() => retrySingleBatchItem(item)}
                          disabled={isBatchRunning || retryingResultTaskId === item.taskId}
                          className="px-2 py-0.5 rounded whitespace-nowrap bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                        >
                          {retryingResultTaskId === item.taskId ? "Retrying..." : "Retry"}
                        </button>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded whitespace-nowrap ${
                          item.success ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {item.success ? "Success" : "Failed"}
                      </span>
                    </div>
                  </div>
                ))}
                {filteredBatchResults.length === 0 && (
                  <div className="px-3 py-6 text-xs text-gray-500 text-center">No results for current filter</div>
                )}
              </div>
            </div>
          )}

          {viewMode === "list" ? (
            <div className="space-y-4">
              {pagedTasks.map((task) => renderTaskActionCard(task))}
            </div>
          ) : (
            <div className="space-y-8">
              {groupTasksByAgentQueue(pagedTasks).map((group) => (
                <section key={group.key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                    <span className="text-xs text-gray-500">{group.tasks.length} tasks</span>
                  </div>
                  <div className="space-y-4">
                    {group.tasks.map((task) => renderTaskActionCard(task as Task))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <TaskCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        projectId={projectId}
      />
    </div>
  )
}
