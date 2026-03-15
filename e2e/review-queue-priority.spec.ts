import { test, expect, type APIRequestContext } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

async function createTeamAndProject(request: APIRequestContext, stamp: string) {
  const teamRes = await request.post("/api/teams", {
    data: {
      name: `Review Queue Team ${stamp}`,
      description: "Review queue priority e2e team"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()
  expect(team?.id).toBeTruthy()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: `Review Queue Project ${stamp}`,
      description: "Review queue priority e2e project",
      teamId: team.id,
      starterTemplateIds: []
    }
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = await projectRes.json()
  expect(project?.id).toBeTruthy()
  return { projectId: project.id as string }
}

async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  dueDate: string | null
) {
  const res = await request.post("/api/tasks", {
    data: {
      title,
      description: "Review queue priority e2e task",
      projectId,
      assigneeType: "HUMAN",
      assignmentMode: "MANUAL",
      priority: "MEDIUM",
      dueDate,
      specMarkdown: `# TaskSpec

## Goal
- Validate review queue defaults

## Deliverables
- Review task appears in review queue

## Requirements
- Task can be transitioned to review status

## Acceptance Criteria
- Task appears in review summary counts

## Priority
- MEDIUM
`
    }
  })
  expect(res.ok()).toBeTruthy()
  const payload = await res.json()
  expect(payload?.id).toBeTruthy()
  return payload.id as string
}

async function updateTaskStatus(request: APIRequestContext, taskId: string, status: string) {
  const res = await request.patch(`/api/tasks/${taskId}/status`, {
    data: { status }
  })
  expect(res.ok()).toBeTruthy()
}

test.describe("Review Queue Priority", () => {
  test("opens review queue from tasks prompt and keeps normalized status params", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "review-queue-prompt-e2e",
      name: "Review Queue Prompt E2E User",
      nicknamePrefix: "review-queue-prompt"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const dueSoon = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    const reviewTaskId = await createTask(
      page.request,
      projectId,
      `Review Prompt Task ${stamp}`,
      dueSoon
    )
    await updateTaskStatus(page.request, reviewTaskId, "REVIEW")

    await page.goto(`/tasks?projectId=${projectId}`)
    await expect(page.getByText("Review Queue has 1 pending task.")).toBeVisible()
    const openReviewQueueButton = page.getByRole("button", { name: "Open Review Queue" })
    await expect(openReviewQueueButton).toHaveAttribute("aria-label", "Open review queue")
    await openReviewQueueButton.click()

    await expect
      .poll(() => {
        const url = new URL(page.url())
        return {
          status: url.searchParams.get("status"),
          taskStatus: url.searchParams.get("taskStatus")
        }
      })
      .toEqual({
        status: "REVIEW",
        taskStatus: "REVIEW"
      })
    await expect(page.getByText("Review Priority Summary")).toBeVisible()
  })

  test("normalizes review status query and applies review-priority defaults", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "review-queue-e2e",
      name: "Review Queue E2E User",
      nicknamePrefix: "review-queue"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const now = Date.now()
    const overdue = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const dueSoon = new Date(now + 4 * 60 * 60 * 1000).toISOString()

    const overdueTaskId = await createTask(
      page.request,
      projectId,
      `Review Overdue ${stamp}`,
      overdue
    )
    const dueSoonTaskId = await createTask(
      page.request,
      projectId,
      `Review Due Soon ${stamp}`,
      dueSoon
    )
    const noDueTaskId = await createTask(
      page.request,
      projectId,
      `Review No Due ${stamp}`,
      null
    )

    await updateTaskStatus(page.request, overdueTaskId, "REVIEW")
    await updateTaskStatus(page.request, dueSoonTaskId, "REVIEW")
    await updateTaskStatus(page.request, noDueTaskId, "REVIEW")

    await page.goto(`/tasks?projectId=${projectId}&status=REVIEW`)
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible()

    await expect
      .poll(() => {
        const url = new URL(page.url())
        return {
          status: url.searchParams.get("status"),
          taskStatus: url.searchParams.get("taskStatus"),
          taskSortBy: url.searchParams.get("taskSortBy"),
          taskSortOrder: url.searchParams.get("taskSortOrder")
        }
      })
      .toEqual({
        status: "REVIEW",
        taskStatus: "REVIEW",
        taskSortBy: "dueDate",
        taskSortOrder: "asc"
      })

    await expect(page.getByText("Review Priority Summary")).toBeVisible()
    await expect(page.getByText("Overdue: 1")).toBeVisible()
    await expect(page.getByText("Due in 24h: 1")).toBeVisible()
    await expect(page.getByText("No due date: 1")).toBeVisible()
    const sortByDueDateButton = page.getByRole("button", { name: "Sort review queue by due date" })
    const highRiskOnlyButton = page.getByRole("button", { name: "Filter review queue to high risk tasks" })
    const resetReviewFiltersButton = page.getByRole("button", { name: "Reset review queue filters" })
    await expect(sortByDueDateButton).toBeVisible()
    await expect(highRiskOnlyButton).toBeVisible()
    await expect(resetReviewFiltersButton).toBeVisible()
    await expect(sortByDueDateButton).toHaveAttribute("aria-label", "Sort review queue by due date")
    await expect(highRiskOnlyButton).toHaveAttribute("aria-label", "Filter review queue to high risk tasks")
    await expect(resetReviewFiltersButton).toHaveAttribute("aria-label", "Reset review queue filters")
  })
})
