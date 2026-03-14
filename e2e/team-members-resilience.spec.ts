import { test, expect, type APIRequestContext } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

async function createTeamAndProject(request: APIRequestContext, stamp: string) {
  const teamName = `Team Members ${stamp}`
  const teamRes = await request.post("/api/teams", {
    data: {
      name: teamName,
      description: "Team members resilience e2e"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()
  expect(team?.id).toBeTruthy()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: `Team Members Project ${stamp}`,
      description: "Project for team members resilience e2e",
      teamId: team.id,
      starterTemplateIds: []
    }
  })
  expect(projectRes.ok()).toBeTruthy()

  return {
    teamId: team.id as string,
    teamName
  }
}

test.describe("Team Members Resilience", () => {
  test("retries transient user-search failure before adding team member", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "team-members-resilience-e2e",
      name: "Team Members Resilience User",
      nicknamePrefix: "team-members-resilience"
    })
    const { teamId, teamName } = await createTeamAndProject(page.request, stamp)

    let searchCalls = 0
    let addCalls = 0

    await page.route("**/api/users/search**", async (route) => {
      searchCalls += 1
      if (searchCalls === 1) {
        await route.abort("failed")
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: `fake-user-${stamp}`,
            name: "Invited User",
            email: "invited.user@example.com"
          }
        ])
      })
    })

    await page.route(`**/api/teams/${teamId}/members`, async (route) => {
      if (route.request().method() === "POST") {
        addCalls += 1
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: `tm-${stamp}`,
            teamId,
            userId: `fake-user-${stamp}`,
            role: "MEMBER"
          })
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/teams/${teamId}`)
    await expect(page.getByRole("heading", { level: 1, name: teamName })).toBeVisible()
    await page.getByRole("button", { name: "Add Member" }).click()
    await page.getByPlaceholder("Enter member email").fill("invited.user@example.com")
    await page.getByRole("button", { name: "Add", exact: true }).click()

    await expect.poll(() => searchCalls).toBe(2)
    await expect.poll(() => addCalls).toBe(1)
  })
})
