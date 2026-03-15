import { test, expect, type APIRequestContext } from "@playwright/test"
import path from "node:path"
import { registerAndLogin } from "./helpers/auth"

async function createTeamAndProject(request: APIRequestContext, stamp: string) {
  const teamName = `Workspace Team ${stamp}`
  const projectName = `Workspace Project ${stamp}`

  const teamRes = await request.post("/api/teams", {
    data: {
      name: teamName,
      description: "Workspace core e2e team"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()
  expect(team?.id).toBeTruthy()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: projectName,
      description: "Workspace core e2e project",
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
  const templateName = `Workspace Template ${stamp}`
  const templateRes = await request.post("/api/templates", {
    data: {
      name: templateName,
      description: "Workspace core template for e2e",
      category: "CUSTOM",
      content: `# Template ${stamp}

## Goal
- Validate template apply flow
`
    }
  })
  expect(templateRes.ok()).toBeTruthy()
  const template = await templateRes.json()
  expect(template?.id).toBeTruthy()
  return { templateId: template.id as string, templateName }
}

async function createTeamsBulk(request: APIRequestContext, stamp: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await request.post("/api/teams", {
      data: {
        name: `Workspace Bulk Team ${stamp}-${String(i + 1).padStart(2, "0")}`,
        description: "Workspace bulk teams for pagination e2e"
      }
    })
    expect(res.ok()).toBeTruthy()
  }
}

async function createFilesBulk(request: APIRequestContext, projectId: string, stamp: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await request.post("/api/files", {
      data: {
        name: `Workspace Paging File ${stamp}-${String(i + 1).padStart(2, "0")}.md`,
        content: `# Paging File ${i + 1}\n\nGenerated for files pagination test.`,
        projectId,
        fileType: "CUSTOM",
        status: "DRAFT"
      }
    })
    expect(res.ok()).toBeTruthy()
  }
}

async function createProjectsBulk(request: APIRequestContext, teamId: string, stamp: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await request.post("/api/projects", {
      data: {
        name: `Workspace Paging Project ${stamp}-${String(i + 1).padStart(2, "0")}`,
        description: "Workspace bulk projects for pagination e2e",
        teamId,
        starterTemplateIds: []
      }
    })
    expect(res.ok()).toBeTruthy()
  }
}

async function createAgentsBulk(request: APIRequestContext, stamp: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const name = `paging-agent-${stamp.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(-14)}-${String(i + 1).padStart(2, "0")}`
    const res = await request.post("/api/agents", {
      data: {
        name,
        displayName: `Paging Agent ${String(i + 1).padStart(2, "0")}`,
        type: "AI",
        capabilities: ["engineering"],
        apiEndpoint: "https://example.com/mcp"
      }
    })
    expect(res.ok()).toBeTruthy()
  }
}

async function createAgentWithCapability(
  request: APIRequestContext,
  stamp: string,
  suffix: string,
  capability: string
) {
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9-]/g, "")
  const name = `filter-agent-${stamp.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(-12)}-${safeSuffix}`
  const res = await request.post("/api/agents", {
    data: {
      name,
      displayName: `Filter ${suffix} ${stamp.slice(-4)}`,
      type: "AI",
      capabilities: [capability],
      apiEndpoint: "https://example.com/mcp"
    }
  })
  expect(res.ok()).toBeTruthy()
  const payload = await res.json()
  expect(payload?.id).toBeTruthy()
  return payload.id as string
}

async function createTasksBulk(request: APIRequestContext, projectId: string, stamp: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await request.post("/api/tasks", {
      data: {
        title: `Workspace Paging Task ${stamp}-${String(i + 1).padStart(2, "0")}`,
        description: "Workspace bulk tasks for pagination e2e",
        projectId,
        assigneeType: "HUMAN",
        assignmentMode: "MANUAL",
        priority: "MEDIUM",
        specMarkdown: `# TaskSpec

## Goal
- Validate task pagination flow

## Deliverables
- A task row rendered on the tasks page

## Requirements
- Task can be listed under project scope

## Acceptance Criteria
- Pagination can navigate to page 2

## Priority
- MEDIUM
`
      }
    })
    expect(res.ok()).toBeTruthy()
  }
}

async function createTask(request: APIRequestContext, projectId: string, title: string) {
  const res = await request.post("/api/tasks", {
    data: {
      title,
      description: "Workspace task filter persistence e2e",
      projectId,
      assigneeType: "HUMAN",
      assignmentMode: "MANUAL",
      priority: "MEDIUM",
      specMarkdown: `# TaskSpec

## Goal
- Verify task filter URL persistence

## Deliverables
- A task item visible in filtered list

## Requirements
- Task can be filtered by status and keyword

## Acceptance Criteria
- Filtered task remains after page reload

## Priority
- MEDIUM
`
    }
  })
  expect(res.ok()).toBeTruthy()
  const payload = await res.json()
  expect(payload?.id).toBeTruthy()
  return payload.id as string
}

async function updateTaskStatus(request: APIRequestContext, taskId: string, status: string) {
  const res = await request.patch(`/api/tasks/${taskId}/status`, {
    data: { status }
  })
  expect(res.ok()).toBeTruthy()
}

type FileItem = { id: string; name: string }

async function listProjectFiles(request: APIRequestContext, projectId: string): Promise<FileItem[]> {
  const res = await request.get(`/api/files?projectId=${projectId}`)
  expect(res.ok()).toBeTruthy()
  const files = (await res.json()) as Array<{ id: string; name: string }>
  return files.map((item) => ({ id: item.id, name: item.name }))
}

test.describe("Workspace Core Flows", () => {
  test("applies a custom template to project from Template Center", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-template-e2e",
      name: "Workspace Template User",
      nicknamePrefix: "workspace-template"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)
    const { templateName } = await createTemplate(page.request, stamp)

    const beforeFiles = await listProjectFiles(page.request, projectId)
    const beforeIds = new Set(beforeFiles.map((file) => file.id))

    await page.goto(`/templates?q=${encodeURIComponent(templateName)}`)
    await expect(page.getByRole("heading", { name: "Template Center" })).toBeVisible()

    const card = page
      .getByRole("heading", { level: 3, name: templateName })
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]")
    await expect(card).toBeVisible()
    await card.getByRole("button", { name: "Use Template" }).click()

    const modal = page
      .getByText("Select Project(s)")
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(modal).toBeVisible()
    await expect(modal.getByText("Selected 1 /")).toBeVisible()

    const dryRunToggle = modal.locator("label", { hasText: "Dry run preview only" }).locator("input")
    if (await dryRunToggle.isChecked()) {
      await dryRunToggle.uncheck()
    }
    await modal.getByRole("button", { name: "Create File" }).click()

    await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 15000 })

    const afterFiles = await listProjectFiles(page.request, projectId)
    expect(afterFiles.length).toBe(beforeFiles.length + 1)
    const created = afterFiles.find((file) => !beforeIds.has(file.id))
    expect(created?.name).toBeTruthy()

    await page.goto(`/files?projectId=${projectId}`)
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()
    await expect(page.getByText(created!.name, { exact: true })).toBeVisible()
  })

  test("imports markdown file into selected project", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-import-e2e",
      name: "Workspace Import User",
      nicknamePrefix: "workspace-import"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const targetFileName = `Imported Workspace ${stamp}.md`
    const beforeFiles = await listProjectFiles(page.request, projectId)
    const fixturePath = path.resolve(process.cwd(), "e2e", "fixtures", "import-sample.md")

    await page.goto("/files/import")
    await expect(page.getByRole("heading", { level: 1, name: "Import Markdown File" })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(fixturePath)
    await page.locator('select[required]').first().selectOption(projectId)
    await page.locator("label:has-text('File Name *') + input").fill(targetFileName)
    await page.getByRole("button", { name: "Import as Markdown" }).click()

    await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 15000 })

    const afterFiles = await listProjectFiles(page.request, projectId)
    expect(afterFiles.length).toBe(beforeFiles.length + 1)
    expect(afterFiles.some((file) => file.name === targetFileName)).toBeTruthy()

    await page.goto(`/files?projectId=${projectId}`)
    await expect(page.getByText(targetFileName, { exact: true })).toBeVisible()
  })

  test("shows created team on Teams page and opens team detail", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-team-e2e",
      name: "Workspace Team User",
      nicknamePrefix: "workspace-team"
    })
    const { teamId, teamName, projectId } = await createTeamAndProject(page.request, stamp)

    await page.goto(`/teams?q=${encodeURIComponent(teamName)}`)
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible()
    const teamLink = page.locator(`a[href="/teams/${teamId}"]`).first()
    await expect(teamLink).toBeVisible()
    await expect(teamLink).toContainText(teamName)
    await teamLink.click()
    await page.waitForURL(new RegExp(`/teams/${teamId}$`), { timeout: 15000 })
    await expect(page.getByRole("heading", { level: 1, name: teamName })).toBeVisible()
    await expect(page.locator(`a[href="/projects/${projectId}"]`).first()).toBeVisible()
  })

  test("supports teams pagination with persisted limit", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-team-page-e2e",
      name: "Workspace Team Paging User",
      nicknamePrefix: "workspace-team-page"
    })
    await createTeamsBulk(page.request, stamp, 11)

    await page.goto(`/teams?q=${encodeURIComponent(`Workspace Bulk Team ${stamp}`)}&limit=9`)
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible()

    const nextLink = page.getByRole("link", { name: "Next" }).first()
    await expect(nextLink).toBeVisible()
    await nextLink.click()
    await expect(page).toHaveURL(/\/teams\?q=.*&limit=9&page=2/)
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible()
  })

  test("supports files pagination with persisted limit", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-file-page-e2e",
      name: "Workspace File Paging User",
      nicknamePrefix: "workspace-file-page"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)
    await createFilesBulk(page.request, projectId, stamp, 12)

    await page.goto(`/files?projectId=${projectId}&q=${encodeURIComponent(`Workspace Paging File ${stamp}`)}&limit=10`)
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()

    const nextLink = page.getByRole("link", { name: "Next" }).first()
    await expect(nextLink).toBeVisible()
    await nextLink.click()
    await expect(page).toHaveURL(/\/files\?/)
    await expect.poll(() => {
      const url = new URL(page.url())
      return {
        projectId: url.searchParams.get("projectId"),
        q: url.searchParams.get("q"),
        limit: url.searchParams.get("limit"),
        page: url.searchParams.get("page")
      }
    }).toEqual({
      projectId,
      q: `Workspace Paging File ${stamp}`,
      limit: "10",
      page: "2"
    })
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()
  })

  test("supports projects pagination with persisted limit", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-project-page-e2e",
      name: "Workspace Project Paging User",
      nicknamePrefix: "workspace-project-page"
    })
    const { teamId } = await createTeamAndProject(page.request, stamp)
    await createProjectsBulk(page.request, teamId, stamp, 7)

    await page.goto(`/projects?q=${encodeURIComponent(`Workspace Paging Project ${stamp}`)}&limit=6`)
    await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()

    const nextLink = page.getByRole("link", { name: "Next" }).first()
    await expect(nextLink).toBeVisible()
    await nextLink.click()
    await expect(page).toHaveURL(/\/projects\?/)
    await expect.poll(() => {
      const url = new URL(page.url())
      return {
        q: url.searchParams.get("q"),
        limit: url.searchParams.get("limit"),
        page: url.searchParams.get("page")
      }
    }).toEqual({
      q: `Workspace Paging Project ${stamp}`,
      limit: "6",
      page: "2"
    })
    await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
  })

  test("supports agents pagination", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-agent-page-e2e",
      name: "Workspace Agent Paging User",
      nicknamePrefix: "workspace-agent-page"
    })
    await createTeamAndProject(page.request, stamp)
    await createAgentsBulk(page.request, stamp, 13)

    await page.goto("/agents")
    await expect(page.getByRole("heading", { level: 1, name: "AI Agents" })).toBeVisible()
    await expect(page.getByText("Page 1")).toBeVisible()

    const nextButton = page.getByRole("button", { name: "Next" }).first()
    await expect(nextButton).toBeEnabled()
    await nextButton.click()
    await expect(page.getByText("Page 2")).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")
    await page.reload()
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")
  })

  test("supports tasks pagination", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-task-page-e2e",
      name: "Workspace Task Paging User",
      nicknamePrefix: "workspace-task-page"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)
    await createTasksBulk(page.request, projectId, stamp, 22)

    await page.goto(`/tasks?projectId=${projectId}`)
    await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible()
    await expect(page.getByText("Page 1")).toBeVisible()

    const nextButton = page.getByRole("button", { name: "Next" }).first()
    await expect(nextButton).toBeEnabled()
    await nextButton.click()
    await expect(page.getByText("Page 2")).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")
    await page.reload()
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2")
  })

  test("persists task filter query params after reload", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-task-filter-e2e",
      name: "Workspace Task Filter User",
      nicknamePrefix: "workspace-task-filter"
    })
    const { projectId } = await createTeamAndProject(page.request, stamp)

    const keepTitle = `Keep Task ${stamp}`
    const skipTitle = `Skip Task ${stamp}`
    const keepTaskId = await createTask(page.request, projectId, keepTitle)
    const skipTaskId = await createTask(page.request, projectId, skipTitle)
    await updateTaskStatus(page.request, keepTaskId, "COMPLETED")
    await updateTaskStatus(page.request, skipTaskId, "PENDING")

    await page.goto(
      `/tasks?projectId=${projectId}&taskStatus=COMPLETED&taskQ=${encodeURIComponent(
        `Keep Task ${stamp}`
      )}&taskView=queue`
    )
    await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("taskStatus")).toBe("COMPLETED")
    await expect.poll(() => new URL(page.url()).searchParams.get("taskQ")).toBe(`Keep Task ${stamp}`)
    await expect(page.getByText(keepTitle)).toBeVisible()
    await expect(page.getByText(skipTitle)).toHaveCount(0)

    await page.reload()
    await expect.poll(() => new URL(page.url()).searchParams.get("taskStatus")).toBe("COMPLETED")
    await expect.poll(() => new URL(page.url()).searchParams.get("taskView")).toBe("queue")
    await expect(page.getByText(keepTitle)).toBeVisible()
    await expect(page.getByText(skipTitle)).toHaveCount(0)
  })

  test("persists agent filter query params after reload", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "workspace-agent-filter-e2e",
      name: "Workspace Agent Filter User",
      nicknamePrefix: "workspace-agent-filter"
    })
    await createTeamAndProject(page.request, stamp)
    await createAgentWithCapability(page.request, stamp, "Eng", "engineering")
    await createAgentWithCapability(page.request, stamp, "QA", "qa")

    await page.goto(
      `/agents?agentQ=${encodeURIComponent(`Filter ${stamp.slice(-4)}`)}&agentCapability=qa&agentStatus=all`
    )
    await expect(page.getByRole("heading", { level: 1, name: "AI Agents" })).toBeVisible()
    await expect(page.locator("input[placeholder='Search agents...']")).toHaveValue(`Filter ${stamp.slice(-4)}`)
    await expect(page.locator("select").filter({ has: page.locator("option[value='qa']") }).first()).toHaveValue("qa")

    await page.reload()
    await expect.poll(() => new URL(page.url()).searchParams.get("agentCapability")).toBe("qa")
    await expect.poll(() => new URL(page.url()).searchParams.get("agentQ")).toBe(
      `Filter ${stamp.slice(-4)}`
    )
    await expect(page.locator("input[placeholder='Search agents...']")).toHaveValue(`Filter ${stamp.slice(-4)}`)
    await expect(page.locator("select").filter({ has: page.locator("option[value='qa']") }).first()).toHaveValue("qa")
  })
})
