import { test, expect, type APIRequestContext } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

async function createTeamAndProject(request: APIRequestContext, stamp: string) {
  const teamRes = await request.post("/api/teams", {
    data: {
      name: `Reports Defaults Team ${stamp}`,
      description: "Reports defaults e2e team"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: `Reports Defaults Project ${stamp}`,
      description: "Reports defaults e2e project",
      teamId: team.id,
      starterTemplateIds: []
    }
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = await projectRes.json()
  return { projectId: project.id as string }
}

test.describe("Report Dialog Defaults", () => {
  test("persists report filter query params after reload", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const saveRes = await page.request.post("/api/projects/bulk-run-report/save", {
      data: {
        projectId,
        reportType: "PROJECT_BULK_STARTER_PACK_REPORT_SAVED",
        content: "# Bulk Starter Runner Report\n\n- persistence check"
      }
    })
    expect(saveRes.ok()).toBeTruthy()

    const q = `bulk ${stamp.slice(-4)}`
    const url = `/reports?projectId=${projectId}&type=PROJECT_BULK_STARTER_PACK_REPORT_SAVED&q=${encodeURIComponent(
      q
    )}&limit=50&page=2`
    await page.goto(url)
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()

    await expect(page.locator("input[name='q']")).toHaveValue(q)
    await expect(page.locator("select[name='type']")).toHaveValue("PROJECT_BULK_STARTER_PACK_REPORT_SAVED")
    await expect(page.locator("select[name='projectId']")).toHaveValue(projectId)
    await expect(page.locator("select[name='limit']")).toHaveValue("50")
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")

    await page.reload()
    await expect.poll(() => new URL(page.url()).searchParams.get("projectId")).toBe(projectId)
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe(
      "PROJECT_BULK_STARTER_PACK_REPORT_SAVED"
    )
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(q)
    await expect.poll(() => new URL(page.url()).searchParams.get("limit")).toBe("50")
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")
    await expect(page.locator("input[name='q']")).toHaveValue(q)
  })

  test("supports grouped-history drill-down links", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const saveRes = await page.request.post("/api/projects/bulk-run-report/save", {
      data: {
        projectId,
        reportType: "PROJECT_BULK_STARTER_PACK_REPORT_SAVED",
        content: "# Bulk Starter Runner Report\n\n- entry"
      }
    })
    expect(saveRes.ok()).toBeTruthy()

    await page.goto(`/reports?projectId=${projectId}`)
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Grouped History Snapshot" })).toBeVisible()

    const drilldownLink = page.getByRole("link", { name: "View records" }).first()
    await expect(drilldownLink).toBeVisible()
    const href = await drilldownLink.getAttribute("href")
    expect(href).toBeTruthy()

    await drilldownLink.click()
    await expect(page).toHaveURL(new RegExp((href || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    await expect(page).toHaveURL(/type=PROJECT_BULK_STARTER_PACK_REPORT_SAVED/)
  })

  test("supports quick filters for bulk runner history types", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    await createTeamAndProject(page.request, stamp)

    await page.goto("/reports")
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Grouped History Snapshot" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Daily Activity Snapshot" })).toBeVisible()

    await page.getByRole("link", { name: "Bulk Starter Pack History" }).first().click()
    await expect(page).toHaveURL(/type=PROJECT_BULK_STARTER_PACK_REPORT_SAVED/)
    await expect(page.getByText("Showing bulk-run archives only.")).toBeVisible()

    await page.getByRole("link", { name: "Bulk Scheduler History" }).first().click()
    await expect(page).toHaveURL(/type=PROJECT_BULK_SCHEDULER_REPORT_SAVED/)
    await expect(page.getByText("Showing bulk-run archives only.")).toBeVisible()
  })

  test("propagates reports page and limit defaults to history export/save actions", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    await createTeamAndProject(page.request, stamp)

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

    let exportQueryMatched = false
    await page.route("**/api/reports/history**", async (route) => {
      const requestUrl = new URL(route.request().url())
      if (
        requestUrl.searchParams.get("projectId") === "p2" &&
        requestUrl.searchParams.get("page") === "3" &&
        requestUrl.searchParams.get("limit") === "100" &&
        requestUrl.searchParams.get("format") === "markdown"
      ) {
        exportQueryMatched = true
      }
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: "# Reports History\n\n- Records: 0\n"
      })
    })

    await page.goto("/reports?projectId=p2&page=3&limit=100")
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()

    await page.getByRole("button", { name: "Export History" }).click()
    await expect.poll(() => exportQueryMatched).toBe(true)

    await page.getByRole("button", { name: "Save History" }).click()
    const saveHistoryDialog = page
      .getByText("Save Reports History")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveHistoryDialog).toBeVisible()
    await expect(saveHistoryDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await expect(saveHistoryDialog.locator("label:has-text('Source Project (optional)') + select")).toHaveValue("p2")
    await expect(saveHistoryDialog.locator("label:has-text('Limit') + input")).toHaveValue("100")
    await expect(saveHistoryDialog.locator("label:has-text('Page') + input")).toHaveValue("3")
    await saveHistoryDialog.getByRole("button", { name: "Cancel" }).click()
  })

  test("uses query filter defaults in Tasks and Reports dialogs", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    await createTeamAndProject(page.request, stamp)

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

    await page.goto("/tasks?projectId=p2&status=IN_PROGRESS")
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible()

    await page.getByRole("button", { name: "Export Tasks" }).click()
    const exportTasksDialog = page
      .getByText("Export Tasks Report")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportTasksDialog).toBeVisible()
    await expect(exportTasksDialog.locator("label:has-text('Source Project (optional)') + select")).toHaveValue("p2")
    await expect(exportTasksDialog.locator("label:has-text('Status Filter (optional)') + select")).toHaveValue("IN_PROGRESS")
    await exportTasksDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Tasks" }).click()
    const saveTasksDialog = page
      .getByText("Save Tasks Report")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveTasksDialog).toBeVisible()
    await expect(saveTasksDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await expect(saveTasksDialog.locator("label:has-text('Source Project (optional)') + select")).toHaveValue("p2")
    await expect(saveTasksDialog.locator("label:has-text('Status Filter (optional)') + select")).toHaveValue("IN_PROGRESS")
    await saveTasksDialog.getByRole("button", { name: "Cancel" }).click()

    await page.goto("/reports?projectId=p2")
    await expect(page.getByRole("heading", { name: "Reports Hub" })).toBeVisible()

    await page.getByRole("button", { name: "Export Status" }).click()
    const exportStatusDialog = page
      .getByText("Export Operations Status")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportStatusDialog).toBeVisible()
    await expect(exportStatusDialog.locator("label:has-text('Source Project (optional)') + select")).toHaveValue("p2")
    await exportStatusDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Status" }).click()
    const saveStatusDialog = page
      .getByText("Save Operations Status Report")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveStatusDialog).toBeVisible()
    await expect(saveStatusDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await expect(saveStatusDialog.locator("label:has-text('Source Project (optional)') + select")).toHaveValue("p2")
    await saveStatusDialog.getByRole("button", { name: "Cancel" }).click()
  })

  test("uses project filter defaults in Projects dialogs", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    await createTeamAndProject(page.request, stamp)

    await page.route("**/api/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "p1", name: "Project Alpha", teamId: "t1", status: "ACTIVE" },
          { id: "p2", name: "Project Beta", teamId: "t2", status: "ACTIVE" }
        ])
      })
    })

    await page.goto("/projects?projectId=p2")
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Export Project History" }).click()
    const exportHistoryDialog = page
      .getByText("Export Project Rollout History")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportHistoryDialog).toBeVisible()
    await expect(exportHistoryDialog.locator("label:has-text('Source Project') + select")).toHaveValue("p2")
    await exportHistoryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Project Rollout History" }).click()
    const saveHistoryDialog = page
      .getByText("Save Project Rollout History")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveHistoryDialog).toBeVisible()
    await expect(saveHistoryDialog.locator("label:has-text('Source Project') + select")).toHaveValue("p2")
    await expect(saveHistoryDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await saveHistoryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Export Project Summary" }).click()
    const exportSummaryDialog = page
      .getByText("Export Project Rollout Summary")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportSummaryDialog).toBeVisible()
    await expect(exportSummaryDialog.locator("label:has-text('Project') + select")).toHaveValue("p2")
    await exportSummaryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Project Rollout Summary" }).click()
    const saveSummaryDialog = page
      .getByText("Save Project Rollout Summary")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveSummaryDialog).toBeVisible()
    await expect(saveSummaryDialog.locator("label:has-text('Project') + select")).toHaveValue("p2")
    await saveSummaryDialog.getByRole("button", { name: "Cancel" }).click()
  })

  test("uses team filter defaults in Teams dialogs", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "defaults-e2e",
      name: "Defaults E2E User",
      nicknamePrefix: "defaults-e2e"
    })
    await createTeamAndProject(page.request, stamp)

    await page.route("**/api/teams**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "t1", name: "Team One" },
          { id: "t2", name: "Team Two" }
        ])
      })
    })

    await page.route("**/api/projects**", async (route) => {
      const url = new URL(route.request().url())
      const teamId = url.searchParams.get("teamId")
      const projects = [
        { id: "p1", name: "Project Alpha", teamId: "t1" },
        { id: "p2", name: "Project Beta", teamId: "t2" }
      ]
      const body = teamId ? projects.filter((project) => project.teamId === teamId) : projects
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      })
    })

    await page.goto("/teams?teamId=t2&projectId=p2")
    await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Export Team Workspace" }).click()
    const exportWorkspaceDialog = page
      .getByText("Export Team Workspace Report")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportWorkspaceDialog).toBeVisible()
    await expect(exportWorkspaceDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await exportWorkspaceDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Team Workspace" }).click()
    const saveWorkspaceDialog = page
      .getByText("Save Team Workspace Report")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveWorkspaceDialog).toBeVisible()
    await expect(saveWorkspaceDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await expect(saveWorkspaceDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await saveWorkspaceDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Export Team History" }).click()
    const exportHistoryDialog = page
      .getByText("Export Team Rollout History")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportHistoryDialog).toBeVisible()
    await expect(exportHistoryDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await exportHistoryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Team Rollout History" }).click()
    const saveHistoryDialog = page
      .getByText("Save Team Rollout History")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveHistoryDialog).toBeVisible()
    await expect(saveHistoryDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await expect(saveHistoryDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await saveHistoryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Export Team Summary" }).click()
    const exportSummaryDialog = page
      .getByText("Export Team Rollout Summary")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(exportSummaryDialog).toBeVisible()
    await expect(exportSummaryDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await exportSummaryDialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: "Save Team Rollout Summary" }).click()
    const saveSummaryDialog = page
      .getByText("Save Team Rollout Summary")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveSummaryDialog).toBeVisible()
    await expect(saveSummaryDialog.locator("label:has-text('Team') + select")).toHaveValue("t2")
    await expect(saveSummaryDialog.locator("label:has-text('Target Project') + select")).toHaveValue("p2")
    await saveSummaryDialog.getByRole("button", { name: "Cancel" }).click()
  })
})
