import { test, expect, type APIRequestContext } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

async function createTeamAndProject(request: APIRequestContext, stamp: string) {
  const teamName = `Team Rollout ${stamp}`
  const projectName = `Team Rollout Project ${stamp}`

  const teamRes = await request.post("/api/teams", {
    data: {
      name: teamName,
      description: "Team rollout e2e team"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()
  expect(team?.id).toBeTruthy()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: projectName,
      description: "Team rollout e2e project",
      teamId: team.id,
      starterTemplateIds: []
    }
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = await projectRes.json()
  expect(project?.id).toBeTruthy()

  return {
    teamId: team.id as string,
    teamName,
    projectId: project.id as string,
    projectName
  }
}

async function createTemplate(request: APIRequestContext, stamp: string) {
  const templateName = `Team Template ${stamp}`
  const templateRes = await request.post("/api/templates", {
    data: {
      name: templateName,
      description: "Template for team rollout e2e",
      category: "CUSTOM",
      content: `# Team Template ${stamp}

## Goal
- Validate team quick use flow
`
    }
  })
  expect(templateRes.ok()).toBeTruthy()
  const template = await templateRes.json()
  expect(template?.id).toBeTruthy()
  return {
    templateId: template.id as string,
    templateName
  }
}

async function createFileFromTemplate(request: APIRequestContext, projectId: string, templateId: string) {
  const fileRes = await request.post("/api/files", {
    data: {
      projectId,
      templateId
    }
  })
  expect(fileRes.ok()).toBeTruthy()
  const file = await fileRes.json()
  expect(file?.id).toBeTruthy()
  return file.id as string
}

type FileItem = { id: string; name: string }

async function listProjectFiles(request: APIRequestContext, projectId: string): Promise<FileItem[]> {
  const res = await request.get(`/api/files?projectId=${projectId}`)
  expect(res.ok()).toBeTruthy()
  const payload = (await res.json()) as Array<{ id: string; name: string }>
  return payload.map((item) => ({ id: item.id, name: item.name }))
}

test.describe("Team Rollout Flows", () => {
  test("previews team starter-pack rollout from team detail", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "team-rollout-e2e",
      name: "Team Rollout User",
      nicknamePrefix: "team-rollout"
    })
    const { teamId, teamName, projectId } = await createTeamAndProject(page.request, stamp)

    let requestMatched = false
    await page.route(`**/api/teams/${teamId}/starter-files/apply-pack`, async (route) => {
      const body = route.request().postDataJSON() as {
        packId?: string
        projectIds?: string[]
        dryRun?: boolean
      }
      if (
        body?.packId === "PM_STARTER" &&
        body?.dryRun === true &&
        Array.isArray(body.projectIds) &&
        body.projectIds.includes(projectId)
      ) {
        requestMatched = true
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          teamId,
          packId: "PM_STARTER",
          dryRun: true,
          total: 1,
          successCount: 1,
          failedCount: 0,
          results: [
            {
              projectId,
              projectName: "Preview Project",
              ok: true,
              createdCount: 0,
              wouldCreateCount: 3,
              skippedCount: 0,
              message: "DRY_RUN"
            }
          ]
        })
      })
    })

    await page.goto(`/teams/${teamId}`)
    await expect(page.getByRole("heading", { level: 1, name: teamName })).toBeVisible()

    await page.getByRole("button", { name: "Preview to 1 Project(s)" }).click()
    await expect.poll(() => requestMatched).toBe(true)
    await expect(page.getByText("Completed 1 · Success 1 · Failed 0")).toBeVisible()
  })

  test("creates file from recommended template using team quick-use action", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "team-quick-use-e2e",
      name: "Team Quick Use User",
      nicknamePrefix: "team-quick-use"
    })
    const { teamId, templateName, projectId } = await (async () => {
      const teamProject = await createTeamAndProject(page.request, stamp)
      const template = await createTemplate(page.request, stamp)
      await createFileFromTemplate(page.request, teamProject.projectId, template.templateId)
      return { ...teamProject, templateName: template.templateName }
    })()

    const beforeFiles = await listProjectFiles(page.request, projectId)

    await page.goto(`/teams/${teamId}`)
    await expect(page.getByRole("heading", { level: 2, name: "Recommended Templates" })).toBeVisible()

    const templateCard = page
      .getByRole("heading", { level: 3, name: templateName })
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]")
    await expect(templateCard).toBeVisible()
    await templateCard.getByRole("button", { name: "Use in Project" }).click()

    const quickUseDialog = page
      .getByRole("heading", { name: "Use Template in Project" })
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(quickUseDialog).toBeVisible()
    await quickUseDialog.getByRole("button", { name: "Create File" }).click()

    await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 15000 })

    const afterFiles = await listProjectFiles(page.request, projectId)
    expect(afterFiles.length).toBe(beforeFiles.length + 1)
  })
})
