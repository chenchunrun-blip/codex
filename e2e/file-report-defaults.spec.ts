import { test, expect } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

test.describe("Files Report Defaults", () => {
  test("uses project query as default for inventory export/save dialogs", async ({ page }) => {
    await registerAndLogin(page, {
      emailPrefix: "files-defaults-e2e",
      name: "Files Defaults E2E User",
      nicknamePrefix: "files-defaults"
    })
    let exportRequestMatched = false

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
    await page.route("**/api/files/inventory?**", async (route) => {
      const requestUrl = route.request().url()
      if (requestUrl.includes("sourceProjectId=p2") && requestUrl.includes("format=markdown")) {
        exportRequestMatched = true
      }
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: "# Files Inventory Report\n"
      })
    })

    await page.goto("/files?projectId=p2")
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()

    await page.getByRole("button", { name: "Export Inventory" }).click()
    await expect.poll(() => exportRequestMatched).toBe(true)

    await page.getByRole("button", { name: "Save Inventory" }).click()
    const saveDialog = page
      .getByText("Save Files Inventory")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(saveDialog).toBeVisible()
    await expect(saveDialog.locator("label:has-text('Project') + select")).toHaveValue("p2")
    await expect(saveDialog.locator("label:has-text('File Name (optional)') + input")).toBeVisible()
    await saveDialog.getByRole("button", { name: "Cancel" }).click()
  })
})
