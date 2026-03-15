import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Agent Queue Console", () => {
  test("clears stale selected agent when switching queue domain", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "queue-console-e2e",
      name: "Queue Console User",
      nicknamePrefix: "queue-console"
    })

    await page.route("**/api/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "p1", name: "Project One", teamId: "t1" }])
      })
    })

    await page.route("**/api/agents", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [
            {
              id: "a-eng",
              name: "eng-agent",
              displayName: "Engineering Agent",
              capabilities: ["engineering"],
              isActive: true
            },
            {
              id: "a-qa",
              name: "qa-agent",
              displayName: "QA Agent",
              capabilities: ["qa"],
              isActive: true
            }
          ]
        })
      })
    })

    let pullPayloadRaw = ""
    await page.route("**/api/tasks/agent-queue/manual-pull", async (route) => {
      pullPayloadRaw = route.request().postData() || ""
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          task: null
        })
      })
    })

    await page.goto("/tasks?projectId=p1")
    await expect(page.getByRole("heading", { name: "Agent Queue Console" })).toBeVisible()

    const queueCard = page
      .getByRole("heading", { name: "Agent Queue Console" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]")

    const domainSelect = queueCard.locator("select").nth(0)
    const agentSelect = queueCard.locator("select").nth(1)
    await expect.poll(async () => agentSelect.locator('option[value="a-eng"]').count()).toBeGreaterThan(0)

    await agentSelect.selectOption("a-eng")
    await domainSelect.selectOption("QA")
    await expect.poll(async () => agentSelect.locator('option[value="a-qa"]').count()).toBeGreaterThan(0)
    await expect(agentSelect).toHaveValue("")

    await queueCard.getByRole("button", { name: "Claim" }).click()
    await expect.poll(() => pullPayloadRaw.length > 0).toBe(true)

    if (!pullPayloadRaw) {
      throw new Error("Expected queue pull payload to be captured")
    }
    const payload = JSON.parse(pullPayloadRaw) as Record<string, unknown>
    expect(payload.projectId).toBe("p1")
    expect(payload.functionalAgentType).toBe("QA")
    expect(payload.claim).toBe(true)
    expect("agentId" in payload).toBe(false)
  })
})
