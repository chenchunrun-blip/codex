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
})
