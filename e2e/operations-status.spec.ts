import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Operations Status Entry Flow", () => {
  test("registers user, signs in, and reaches operations status entry points", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-e2e",
      name: "Ops E2E User",
      nicknamePrefix: "ops-e2e"
    })

    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/tasks")
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/agents")
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/reports")
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/projects")
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/teams")
    await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible()
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/files")
    await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible()
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/templates")
    await expect(page.getByRole("heading", { name: "Template Center", exact: true })).toBeVisible()
    await expect(
      page.getByText(/Operations Status|No accessible projects yet/i).first()
    ).toBeVisible()

    await page.goto("/operations")
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible()
  })

  test("uses project scope on reports page and keeps scope on refresh", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-scope-e2e",
      name: "Ops Scope E2E User",
      nicknamePrefix: "ops-scope"
    })

    let scopedRequests = 0
    await page.route("**/api/operations/status**", async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get("sourceProjectId") === "p2") {
        scopedRequests += 1
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: url.searchParams.get("sourceProjectId"),
          projectCount: 1,
          queueBacklogTotal: 3,
          queueDomains: [{ domain: "ENGINEERING", backlog: 3 }],
          scheduler: {
            batchesStarted24h: 2,
            batchesCompleted24h: 2,
            autoDispatched24h: 4,
            autoDispatchFailed24h: 0,
            lastBatchAt: new Date().toISOString()
          },
          agentRuns: {
            triggered24h: 5,
            failed24h: 1
          },
          reports: {
            saved24h: 3,
            topTypes: [{ type: "operations_status", count: 3 }]
          }
        })
      })
    })

    await page.route("**/api/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "p1", name: "Project Alpha", teamId: "t1" },
          { id: "p2", name: "Project Beta", teamId: "t1" }
        ])
      })
    })

    await page.goto("/operations?projectId=p2")
    await expect(page.getByRole("heading", { name: "Operations Status" })).toBeVisible()
    await expect.poll(() => scopedRequests).toBeGreaterThan(0)

    const beforeRefresh = scopedRequests
    await page.getByRole("button", { name: "Refresh operations status" }).click()
    await expect.poll(() => scopedRequests).toBeGreaterThan(beforeRefresh)
  })

  test("keeps last queue snapshot when refresh fails", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-queue-fallback-e2e",
      name: "Ops Queue Fallback E2E User",
      nicknamePrefix: "ops-queue-fallback"
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
          sourceProjectId: "p1",
          projectCount: 1,
          queueBacklogTotal: 1,
          queueDomains: [{ domain: "ENGINEERING", backlog: 1 }],
          scheduler: {
            batchesStarted24h: 1,
            batchesCompleted24h: 1,
            autoDispatched24h: 1,
            autoDispatchFailed24h: 0,
            lastBatchAt: new Date().toISOString()
          },
          agentRuns: {
            triggered24h: 1,
            failed24h: 0
          },
          reports: {
            saved24h: 1,
            topTypes: [{ type: "operations_status", count: 1 }]
          }
        })
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

    await page.route("**/api/tasks/metrics**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope: { projectId: "p1", days: 14 },
          backlog: { total: 1, byQueueDomain: [{ domain: "ENGINEERING", count: 1 }] },
          execution: { runs: 1, success: 1, failed: 0, successRate: 100 },
          completion: { completedTasks: 0, avgCompletionHours: null },
          risk: { overdue: 0, dueIn24h: 0, dueIn3d: 0, total: 0 },
          failures: [],
          dispatchHistory: [],
          retryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT"],
          availableRetryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT"],
          retryConfigUpdatedAt: null,
          retryConfigSource: "default",
          dispatchPolicyOnlineOnly: false,
          dispatchPolicySource: "default"
        })
      })
    })

    let queueRequestCount = 0
    await page.route("**/api/agents/queue-status**", async (route) => {
      queueRequestCount += 1
      if (queueRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            projectId: "p1",
            domains: [
              { domain: "ENGINEERING", backlog: 2, activeAgents: 1, onlineAgents: 1 },
              { domain: "PRODUCT", backlog: 0, activeAgents: 0, onlineAgents: 0 }
            ]
          })
        })
        return
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Failed to fetch queue status",
          code: "INTERNAL_ERROR"
        })
      })
    })

    await page.goto("/operations?projectId=p1")
    await expect(page.getByRole("heading", { name: "Agent Queue Status" })).toBeVisible()
    const engineeringRow = page.locator("tr").filter({ hasText: "ENGINEERING" }).first()
    await expect(engineeringRow).toBeVisible()
    await expect(engineeringRow).toContainText("2")

    await page.getByRole("button", { name: "Refresh agent queue status" }).click()
    await expect(page.getByText("Showing last successful snapshot.")).toBeVisible()
    await expect(engineeringRow).toBeVisible()
  })

  test("keeps last task operations snapshot when metrics refresh fails", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-metrics-fallback-e2e",
      name: "Ops Metrics Fallback E2E User",
      nicknamePrefix: "ops-metrics-fallback"
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
          sourceProjectId: "p1",
          projectCount: 1,
          queueBacklogTotal: 1,
          queueDomains: [{ domain: "ENGINEERING", backlog: 1 }],
          scheduler: {
            batchesStarted24h: 1,
            batchesCompleted24h: 1,
            autoDispatched24h: 1,
            autoDispatchFailed24h: 0,
            lastBatchAt: new Date().toISOString()
          },
          agentRuns: {
            triggered24h: 1,
            failed24h: 0
          },
          reports: {
            saved24h: 1,
            topTypes: [{ type: "operations_status", count: 1 }]
          }
        })
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

    await page.route("**/api/agents/queue-status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projectId: "p1",
          domains: [{ domain: "ENGINEERING", backlog: 1, activeAgents: 1, onlineAgents: 1 }]
        })
      })
    })

    let metricsRequestCount = 0
    await page.route("**/api/tasks/metrics**", async (route) => {
      metricsRequestCount += 1
      if (metricsRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            scope: { projectId: "p1", days: 14 },
            backlog: { total: 4, byQueueDomain: [{ domain: "ENGINEERING", count: 4 }] },
            execution: { runs: 4, success: 3, failed: 1, successRate: 75 },
            completion: { completedTasks: 2, avgCompletionHours: 12.5 },
            risk: { overdue: 0, dueIn24h: 1, dueIn3d: 1, total: 2 },
            failures: [{ reason: "AGENT_RUN_CONFLICT", count: 1 }],
            dispatchHistory: [],
            retryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT", "AGENT_RUN_CONFLICT"],
            availableRetryableErrorCodes: ["AGENT_EXECUTION_TIMEOUT", "AGENT_RUN_CONFLICT"],
            retryConfigUpdatedAt: null,
            retryConfigSource: "default",
            dispatchPolicyOnlineOnly: false,
            dispatchPolicySource: "default"
          })
        })
        return
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Failed to fetch task metrics",
          code: "INTERNAL_ERROR"
        })
      })
    })

    await page.goto("/operations?projectId=p1")
    await expect(page.getByRole("heading", { name: "Operations Snapshot" })).toBeVisible()
    await expect(page.getByText("3/4 successful runs")).toBeVisible()

    await page.getByRole("button", { name: "Refresh task operations snapshot" }).click()
    await expect(page.getByText("Showing last successful snapshot.")).toBeVisible()
    await expect(page.getByText("3/4 successful runs")).toBeVisible()
  })

  test("keeps last operations status snapshot when refresh fails", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-status-fallback-e2e",
      name: "Ops Status Fallback E2E User",
      nicknamePrefix: "ops-status-fallback"
    })

    await page.route("**/api/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "p1", name: "Project Alpha", teamId: "t1" }])
      })
    })

    await page.route("**/api/operations/health**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: null,
          health: { level: "HEALTHY", issueCount: 0, issues: [] }
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

    let statusRequestCount = 0
    await page.route("**/api/operations/status**", async (route) => {
      statusRequestCount += 1
      if (statusRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            generatedAt: new Date().toISOString(),
            sourceProjectId: null,
            projectCount: 2,
            queueBacklogTotal: 5,
            queueDomains: [{ domain: "ENGINEERING", backlog: 5 }],
            scheduler: {
              batchesStarted24h: 3, batchesCompleted24h: 3,
              autoDispatched24h: 6, autoDispatchFailed24h: 0,
              lastBatchAt: new Date().toISOString()
            },
            agentRuns: { triggered24h: 8, failed24h: 2 },
            reports: { saved24h: 4, topTypes: [{ type: "operations_status", count: 4 }] }
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
    await expect(page.getByRole("heading", { name: "Operations Status" })).toBeVisible()
    await expect(page.getByText("5").first()).toBeVisible()

    await page.getByRole("button", { name: "Refresh operations status" }).click()
    await expect(page.getByText("Showing last successful snapshot.")).toBeVisible()
    await expect(page.getByText("5").first()).toBeVisible()
  })

  test("shows degraded notice on queue status response", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "ops-degraded-e2e",
      name: "Ops Degraded E2E User",
      nicknamePrefix: "ops-degraded"
    })

    await page.route("**/api/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "p1", name: "Project Alpha", teamId: "t1" }])
      })
    })

    await page.route("**/api/operations/health**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: null,
          health: { level: "DEGRADED", issueCount: 1, issues: [{ code: "QUEUE_BACKLOG_HIGH", level: "DEGRADED", message: "Queue backlog is elevated (12)." }] }
        })
      })
    })

    await page.route("**/api/operations/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          sourceProjectId: null,
          projectCount: 1, queueBacklogTotal: 12,
          queueDomains: [{ domain: "ENGINEERING", backlog: 12 }],
          scheduler: { batchesStarted24h: 1, batchesCompleted24h: 1, autoDispatched24h: 1, autoDispatchFailed24h: 0, lastBatchAt: new Date().toISOString() },
          agentRuns: { triggered24h: 1, failed24h: 0 },
          reports: { saved24h: 0, topTypes: [] }
        })
      })
    })

    await page.route("**/api/tasks/metrics**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope: { projectId: null, days: 14 },
          degraded: true,
          backlog: { total: 12, byQueueDomain: [{ domain: "ENGINEERING", count: 12 }] },
          execution: { runs: 1, success: 1, failed: 0, successRate: 100 },
          completion: { completedTasks: 0, avgCompletionHours: null },
          risk: { overdue: 0, dueIn24h: 0, dueIn3d: 0, total: 0 },
          failures: [], dispatchHistory: [],
          retryableErrorCodes: [], availableRetryableErrorCodes: [],
          retryConfigUpdatedAt: null, retryConfigSource: "default",
          dispatchPolicyOnlineOnly: false, dispatchPolicySource: "default"
        })
      })
    })

    await page.route("**/api/agents/queue-status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projectId: null,
          domains: [{ domain: "ENGINEERING", backlog: 12, activeAgents: 1, onlineAgents: 1 }],
          degraded: true
        })
      })
    })

    await page.goto("/operations")
    await expect(page.getByText("Operations Health: DEGRADED")).toBeVisible()
    await expect(page.getByText("Queue backlog is elevated (12).")).toBeVisible()
    await expect(page.getByText(/temporarily degraded/i)).toBeVisible()
  })
})
