import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Operations Health Banner", () => {
  test("shows CRITICAL health banner and respects project scope", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-health-e2e",
      name: "Ops Health E2E User",
      nicknamePrefix: "ops-health"
    })

    let scopedRequestSeen = false
    await page.route("**/api/operations/health**", async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get("sourceProjectId") === "p2") {
        scopedRequestSeen = true
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: url.searchParams.get("sourceProjectId"),
          health: {
            level: "CRITICAL",
            issueCount: 2,
            issues: [
              {
                code: "QUEUE_BACKLOG_CRITICAL",
                level: "CRITICAL",
                message: "Queue backlog is high (45)."
              },
              {
                code: "AGENT_RUN_FAILURE_CRITICAL",
                level: "CRITICAL",
                message: "Agent run failure rate is high (50%)."
              }
            ]
          }
        })
      })
    })

    await page.route("**/api/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "p1", name: "Project Alpha", teamId: "t1" },
          { id: "p2", name: "Project Beta", teamId: "t1" }
        ])
      })
    })

    await expect(page.getByText("Operations Health: CRITICAL")).toBeVisible()
    await expect(page.getByText("Queue backlog is high (45).")).toBeVisible()

    await page.goto("/tasks?projectId=p2")
    await expect(page.getByText("Operations Health: CRITICAL")).toBeVisible()
    await expect.poll(() => scopedRequestSeen).toBe(true)

    await page.goto("/operations?projectId=p2")
    await expect(page.getByText("Operations Health: CRITICAL")).toBeVisible()
  })

  test("keeps last health snapshot when refresh fails", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-health-fallback-e2e",
      name: "Ops Health Fallback E2E User",
      nicknamePrefix: "ops-health-fb"
    })

    await page.route("**/api/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "p1", name: "Project Alpha", teamId: "t1" }])
      })
    })

    await page.route("**/api/operations/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: null,
          projectCount: 1, queueBacklogTotal: 0,
          queueDomains: [],
          scheduler: { batchesStarted24h: 0, batchesCompleted24h: 0, autoDispatched24h: 0, autoDispatchFailed24h: 0, lastBatchAt: null },
          agentRuns: { triggered24h: 0, failed24h: 0 },
          reports: { saved24h: 0, topTypes: [] }
        })
      })
    })

    await page.route("**/api/agents/queue-status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projectId: null, domains: [] })
      })
    })

    await page.route("**/api/tasks/metrics**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope: { projectId: null, days: 14 },
          backlog: { total: 0, byQueueDomain: [] },
          execution: { runs: 0, success: 0, failed: 0, successRate: 0 },
          completion: { completedTasks: 0, avgCompletionHours: null },
          risk: { overdue: 0, dueIn24h: 0, dueIn3d: 0, total: 0 },
          failures: [], dispatchHistory: [],
          retryableErrorCodes: [], availableRetryableErrorCodes: [],
          retryConfigUpdatedAt: null, retryConfigSource: "default",
          dispatchPolicyOnlineOnly: false, dispatchPolicySource: "default"
        })
      })
    })

    let healthRequestCount = 0
    await page.route("**/api/operations/health**", async (route) => {
      healthRequestCount += 1
      if (healthRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            generatedAt: new Date().toISOString(),
            sourceProjectId: null,
            health: {
              level: "DEGRADED",
              issueCount: 1,
              issues: [{ code: "SCHEDULER_LAG", level: "DEGRADED", message: "Scheduler has not run in 2 hours." }]
            }
          })
        })
        return
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal error", code: "INTERNAL_ERROR" })
      })
    })

    await page.goto("/operations")
    await expect(page.getByText("Operations Health: DEGRADED")).toBeVisible()
    await expect(page.getByText("Scheduler has not run in 2 hours.")).toBeVisible()

    await page.getByRole("button", { name: "Refresh operations health" }).click()
    await expect(page.getByText("Showing last successful snapshot.")).toBeVisible()
    await expect(page.getByText("Operations Health: DEGRADED")).toBeVisible()
    await expect(page.getByText("Scheduler has not run in 2 hours.")).toBeVisible()
  })
})
