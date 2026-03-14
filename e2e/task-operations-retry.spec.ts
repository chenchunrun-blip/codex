import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Task Operations Retry", () => {
  test("retries only retryable failed tasks from dispatch history", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "task-retry-e2e",
      name: "Task Retry User",
      nicknamePrefix: "task-retry"
    })

    await page.route("**/api/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "p1", name: "Project One", teamId: "t1" }])
      })
    })
    await page.route("**/api/tasks?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks: [] })
      })
    })
    await page.route("**/api/users", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    })
    await page.route("**/api/user/profile", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "u1", email: "task-retry@example.com" })
      })
    })
    await page.route("**/api/agents", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agents: [] })
      })
    })
    await page.route("**/api/agents/queue-status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projectId: "p1", domains: [] })
      })
    })
    await page.route("**/api/operations/health**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: "p1",
          health: {
            level: "HEALTHY",
            issueCount: 0,
            issues: []
          }
        })
      })
    })
    await page.route("**/api/operations/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: "p1",
          projectCount: 1,
          queueBacklogTotal: 0,
          queueDomains: [],
          scheduler: {
            batchesStarted24h: 1,
            batchesCompleted24h: 1,
            autoDispatched24h: 2,
            autoDispatchFailed24h: 1,
            lastBatchAt: new Date().toISOString()
          },
          agentRuns: {
            triggered24h: 2,
            failed24h: 1
          },
          reports: {
            saved24h: 1,
            topTypes: []
          }
        })
      })
    })

    await page.route("**/api/tasks/metrics**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope: { projectId: "p1", days: 14 },
          retryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT"],
          availableRetryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT", "AGENT_ENDPOINT_ERROR"],
          retryConfigUpdatedAt: new Date().toISOString(),
          retryConfigSource: "default",
          dispatchPolicyOnlineOnly: true,
          dispatchPolicySource: "default",
          backlog: { total: 0, byQueueDomain: [] },
          execution: { runs: 2, success: 1, failed: 1, successRate: 50 },
          completion: { completedTasks: 1, avgCompletionHours: 2.5 },
          risk: { overdue: 0, dueIn24h: 0, dueIn3d: 0, total: 0 },
          failures: [{ reason: "runtime", count: 1 }],
          dispatchHistory: [
            {
              createdAt: new Date().toISOString(),
              total: 2,
              successCount: 0,
              failedCount: 2,
              triggerMode: "MANUAL",
              batchId: "batch-retry-1",
              idempotencyKey: "idem-1",
              failedTasks: [
                {
                  taskId: "task-retryable",
                  error: "timeout",
                  errorCode: "AGENT_EXECUTION_TIMEOUT"
                },
                {
                  taskId: "task-non-retryable",
                  error: "validation",
                  errorCode: "INVALID_TASK_STATE"
                }
              ]
            },
            {
              createdAt: new Date(Date.now() - 60_000).toISOString(),
              total: 1,
              successCount: 0,
              failedCount: 1,
              triggerMode: "MANUAL",
              batchId: "batch-retry-2",
              idempotencyKey: "idem-2",
              failedTasks: [
                {
                  taskId: "task-only-non-retryable",
                  error: "validation",
                  errorCode: "INVALID_TASK_STATE"
                }
              ]
            }
          ]
        })
      })
    })

    let retryPayloadRaw = ""
    await page.route("**/api/tasks/scheduler/trigger", async (route) => {
      retryPayloadRaw = route.request().postData() || ""
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projectId: "p1",
          total: 1,
          successCount: 1,
          failedCount: 0,
          triggerMode: "MANUAL",
          results: [{ taskId: "task-retryable", status: "SUCCESS" }]
        })
      })
    })

    await page.goto("/tasks?projectId=p1")
    await expect(page.getByRole("heading", { name: "Operations Snapshot" })).toBeVisible()

    const snapshot = page
      .getByRole("heading", { name: "Operations Snapshot" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")

    await snapshot.getByRole("button", { name: "Show" }).first().click()
    await expect(snapshot.getByText("Retryable: 1")).toBeVisible()
    await snapshot.getByRole("button", { name: "Retry failed runtime errors" }).first().click()

    await expect.poll(() => retryPayloadRaw.length > 0).toBe(true)
    const retryPayload = JSON.parse(retryPayloadRaw) as Record<string, unknown>
    expect(retryPayload.projectId).toBe("p1")
    expect(retryPayload.taskIds).toEqual(["task-retryable"])

    await snapshot.getByRole("button", { name: "Show" }).nth(1).click()
    await expect(snapshot.getByText("Retryable: 0")).toBeVisible()
    const retryButtons = snapshot.getByRole("button", { name: "Retry failed runtime errors" })
    await expect(retryButtons).toHaveCount(1)
    await expect(retryButtons.first()).toBeDisabled()
  })
})
