import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Workspace Onboarding Empty States", () => {
  test("shows project onboarding guidance across Files/Reports/Tasks/Projects/Teams/Templates when user has no project membership", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "empty-workspace-e2e",
      name: "Empty Workspace User",
      nicknamePrefix: "empty-workspace"
    })

    await page.goto("/files")
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 3, name: "No accessible projects yet" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to Projects" })).toBeVisible()

    await page.goto("/reports")
    await expect(page.getByRole("heading", { level: 1, name: "Reports Hub" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "No accessible projects yet" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to Teams" })).toBeVisible()

    await page.goto("/tasks")
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "No accessible projects yet" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to Projects" })).toBeVisible()

    await page.goto("/projects")
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 3, name: "No accessible projects yet" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go to Teams" })).toBeVisible()

    await page.goto("/teams")
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible()
    const teamsEmpty = page.getByText("No teams yet").locator("xpath=ancestor::div[contains(@class,'text-center')]").first()
    await expect(teamsEmpty.getByRole("heading", { level: 3, name: "No teams yet" })).toBeVisible()
    await expect(teamsEmpty.getByRole("link", { name: "Browse Templates" })).toBeVisible()

    await page.goto("/templates")
    await expect(page.getByRole("heading", { level: 1, name: "Template Center" })).toBeVisible()
    await expect(page.getByText("No editable projects yet. Create or join a project to enable quick apply for starter packs.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Quick Apply" }).first()).toBeDisabled()
    await expect(page.getByRole("button", { name: "Team Quick Apply" }).first()).toBeDisabled()

    await page.goto("/dashboard")
    const workflowReviewLink = page.getByRole("link", { name: "Review Queue" }).first()
    await expect(workflowReviewLink).toBeVisible()
    await expect(workflowReviewLink).toHaveAttribute("href", /\/tasks\?status=REVIEW/)

    const getStartedBlock = page
      .locator("div.text-center.py-12")
      .filter({ has: page.getByRole("heading", { level: 3, name: "Get Started" }) })
      .first()
    await expect(getStartedBlock.getByRole("heading", { level: 3, name: "Get Started" })).toBeVisible()
    await getStartedBlock.getByRole("link", { name: "Create Team" }).click()
    await expect(page).toHaveURL(/\/teams$/)
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible()
  })
})
