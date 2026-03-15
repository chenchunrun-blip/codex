import { test, expect, type APIRequestContext } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth"

async function createTeamProjectAndFile(request: APIRequestContext, stamp: string) {
  const teamRes = await request.post("/api/teams", {
    data: {
      name: `E2E Team ${stamp}`,
      description: "E2E collaboration flow team"
    }
  })
  expect(teamRes.ok()).toBeTruthy()
  const team = await teamRes.json()
  expect(team?.id).toBeTruthy()

  const projectRes = await request.post("/api/projects", {
    data: {
      name: `E2E Project ${stamp}`,
      description: "E2E collaboration flow project",
      teamId: team.id,
      starterTemplateIds: []
    }
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = await projectRes.json()
  expect(project?.id).toBeTruthy()

  const fileRes = await request.post("/api/files", {
    data: {
      projectId: project.id,
      name: `e2e-source-${stamp}.md`,
      content: `# Source Markdown

## Goal
- Validate markdown to task flow

## Deliverables
- A task created from source file

## Requirements
- Keep request minimal

## Acceptance Criteria
- Task is created and visible in task detail page

## Priority
- MEDIUM
`
    }
  })
  expect(fileRes.ok()).toBeTruthy()
  const file = await fileRes.json()
  expect(file?.id).toBeTruthy()

  return {
    teamId: team.id as string,
    projectId: project.id as string,
    fileId: file.id as string,
    fileName: file.name as string
  }
}

async function createTask(request: APIRequestContext, projectId: string, stamp: string) {
  const taskRes = await request.post("/api/tasks", {
    data: {
      title: `Deliverable Flow Task ${stamp}`,
      description: "Task for deliverable submit/review e2e",
      projectId,
      assigneeType: "HUMAN",
      assignmentMode: "MANUAL",
      priority: "MEDIUM",
      specMarkdown: `# TaskSpec

## Goal
- Validate deliverable submit/review loop

## Deliverables
- A submitted deliverable that can be reviewed

## Requirements
- Human submits and reviews in task page

## Acceptance Criteria
- Deliverable can be approved from review dialog

## Priority
- MEDIUM
`
    }
  })
  expect(taskRes.ok()).toBeTruthy()
  const task = await taskRes.json()
  expect(task?.id).toBeTruthy()
  return task.id as string
}

async function createAgent(request: APIRequestContext, stamp: string) {
  const name = `eng-agent-${stamp.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(-20)}`
  const agentRes = await request.post("/api/agents", {
    data: {
      name,
      displayName: `Engineering Agent ${stamp.slice(-4)}`,
      type: "AI",
      capabilities: ["engineering", "qa"],
      apiEndpoint: "https://example.com/mcp"
    }
  })
  expect(agentRes.ok()).toBeTruthy()
  const agent = await agentRes.json()
  expect(agent?.id).toBeTruthy()
  return agent.id as string
}

async function createAgentAssignedTask(
  request: APIRequestContext,
  projectId: string,
  agentId: string,
  stamp: string
) {
  const taskRes = await request.post("/api/tasks", {
    data: {
      title: `Agent Deliverable Task ${stamp}`,
      description: "Task for rejection requeue flow e2e",
      projectId,
      assigneeType: "AGENT",
      assignmentMode: "MANUAL",
      agentId,
      priority: "MEDIUM",
      specMarkdown: `# TaskSpec

## Goal
- Validate reject-to-queue flow

## Deliverables
- One deliverable submitted then rejected

## Requirements
- Rejection must include feedback

## Acceptance Criteria
- Task is requeued to agent queue

## Priority
- MEDIUM
`
    }
  })
  expect(taskRes.ok()).toBeTruthy()
  const task = await taskRes.json()
  expect(task?.id).toBeTruthy()
  return task.id as string
}

async function createQueueTask(request: APIRequestContext, projectId: string, stamp: string) {
  const taskRes = await request.post("/api/tasks", {
    data: {
      title: `Queue Claim Task ${stamp}`,
      description: "Task for agent queue claim loop e2e",
      projectId,
      assigneeType: "FUNCTIONAL_AGENT",
      assignmentMode: "MANUAL",
      functionalAgentType: "ENGINEERING",
      priority: "MEDIUM",
      specMarkdown: `# TaskSpec

## Goal
- Validate queue claim flow

## Deliverables
- One claimed queue task

## Requirements
- Claim from agent queue

## Acceptance Criteria
- Assignment log contains CLAIMED action

## Priority
- MEDIUM
`
    }
  })
  expect(taskRes.ok()).toBeTruthy()
  const task = await taskRes.json()
  expect(task?.id).toBeTruthy()
  return task.id as string
}

async function applyStarterPack(
  request: APIRequestContext,
  projectId: string,
  packId: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER" = "PM_STARTER"
) {
  const applyRes = await request.post(`/api/projects/${projectId}/starter-files/apply-pack`, {
    data: {
      packId,
      dryRun: false,
      skipExistingByTemplateType: true
    }
  })
  expect(applyRes.ok()).toBeTruthy()
  const payload = await applyRes.json()
  expect(typeof payload?.createdCount).toBe("number")
  return payload as {
    createdCount: number
    created: Array<{ fileId: string }>
  }
}

test.describe("Core Collaboration Flow", () => {
  test("applies starter pack to project and creates markdown workspace files", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId, fileName } = await createTeamProjectAndFile(page.request, stamp)

    const beforeRes = await page.request.get(`/api/files?projectId=${projectId}`)
    expect(beforeRes.ok()).toBeTruthy()
    const beforeFiles = (await beforeRes.json()) as Array<{ id: string }>

    const applyResult = await applyStarterPack(page.request, projectId, "PM_STARTER")
    expect(applyResult.createdCount).toBeGreaterThan(0)

    const afterRes = await page.request.get(`/api/files?projectId=${projectId}`)
    expect(afterRes.ok()).toBeTruthy()
    const afterFiles = (await afterRes.json()) as Array<{ id: string; name: string }>

    expect(afterFiles.length).toBeGreaterThanOrEqual(beforeFiles.length + applyResult.createdCount)
    for (const item of applyResult.created) {
      expect(afterFiles.some((file) => file.id === item.fileId)).toBeTruthy()
    }

    await page.goto(`/files?projectId=${projectId}`)
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()
    await expect(page.getByText(fileName, { exact: true })).toBeVisible()
  })

  test("runs starter-pack bulk runner from Projects page", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId } = await createTeamProjectAndFile(page.request, stamp)

    let requestMatched = false
    await page.route("**/api/projects/starter-files/bulk-apply-pack", async (route) => {
      const body = route.request().postDataJSON() as {
        packId?: string
        projectIds?: string[]
        dryRun?: boolean
      }
      if (
        body?.packId === "PM_STARTER" &&
        Array.isArray(body.projectIds) &&
        body.projectIds.includes(projectId) &&
        body?.dryRun === true
      ) {
        requestMatched = true
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 1,
          successCount: 1,
          failedCount: 0,
          dryRun: true,
          results: [
            {
              projectId,
              ok: true,
              createdCount: 0,
              wouldCreateCount: 4,
              skippedCount: 0,
              message: "preview completed"
            }
          ]
        })
      })
    })

    await page.goto("/projects")
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Preview to 1 Project(s)" }).click()
    await expect.poll(() => requestMatched).toBe(true)
    await expect(page.getByText("Completed 1 · Success 1 · Failed 0")).toBeVisible()
  })

  test("creates task from markdown file and opens task detail", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId, fileName } = await createTeamProjectAndFile(page.request, stamp)

    await page.goto(`/files?projectId=${projectId}`)
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible()
    await expect(page.getByText(fileName, { exact: true })).toBeVisible()

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt")
      await dialog.accept(`Task from ${stamp}`)
    })

    const row = page.locator("tr", { hasText: fileName }).first()
    await row.getByRole("button", { name: "Create Task" }).click()

    await page.waitForURL(/\/tasks\/[^/]+$/, { timeout: 15000 })
    await expect(page.getByRole("heading", { name: "TaskSpec", exact: true })).toBeVisible()
  })

  test("submits and approves deliverable from task detail", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId } = await createTeamProjectAndFile(page.request, stamp)
    const taskId = await createTask(page.request, projectId, stamp)

    await page.goto(`/tasks/${taskId}`)
    await expect(page.getByRole("heading", { name: "Deliverables", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Submit Deliverable" }).click()
    const submitDialog = page
      .getByRole("heading", { name: "Submit Deliverable" })
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(submitDialog).toBeVisible()
    await submitDialog.getByPlaceholder("Implementation summary").fill("Implementation Summary")
    await submitDialog
      .getByPlaceholder("# Deliverable")
      .fill("# Implementation Summary\n\n- Completed feature\n- Added tests")
    await submitDialog.getByRole("button", { name: "Submit", exact: true }).click()
    await expect(submitDialog).toBeHidden()

    const reviewButtons = page.getByRole("button", { name: "Review" })
    await expect(reviewButtons.first()).toBeVisible()
    await reviewButtons.first().click()
    await expect(page.getByRole("heading", { name: "Review Deliverable" })).toBeVisible()
    await page.getByRole("button", { name: "Approve" }).first().click()
    await page.getByRole("button", { name: /^Approve$/ }).last().click()

    await expect(page.getByText("Approved")).toBeVisible()
  })

  test("rejects deliverable and requeues agent task with revision appendix", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId } = await createTeamProjectAndFile(page.request, stamp)
    const agentId = await createAgent(page.request, stamp)
    const taskId = await createAgentAssignedTask(page.request, projectId, agentId, stamp)

    await page.goto(`/tasks/${taskId}`)
    await expect(page.getByRole("heading", { name: "Deliverables", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Submit Deliverable" }).click()
    const submitDialog = page
      .getByRole("heading", { name: "Submit Deliverable" })
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(submitDialog).toBeVisible()
    await submitDialog.getByPlaceholder("Implementation summary").fill("Need revision")
    await submitDialog
      .getByPlaceholder("# Deliverable")
      .fill("# Need Revision\n\n- Initial output")
    await submitDialog.getByRole("button", { name: "Submit", exact: true }).click()
    await expect(submitDialog).toBeHidden()

    const reviewButtons = page.getByRole("button", { name: "Review" })
    await expect(reviewButtons.first()).toBeVisible()
    await reviewButtons.first().click()

    const reviewDialog = page
      .getByRole("heading", { name: "Review Deliverable" })
      .locator("xpath=ancestor::div[contains(@class,'shadow-xl')]")
      .first()
    await expect(reviewDialog).toBeVisible()
    await reviewDialog.getByRole("button", { name: "Reject" }).first().click()
    await reviewDialog
      .getByPlaceholder("Explain why this deliverable was rejected and what needs to be changed...")
      .fill("Please add validation evidence and edge-case coverage.")
    await reviewDialog.getByRole("button", { name: /^Reject$/ }).last().click()

    await expect(page.getByText("Rejected")).toBeVisible()
    await expect(page.getByText("queue: ENGINEERING")).toBeVisible()
    await expect(page.getByText("Revision Request")).toBeVisible()
  })

  test("claims task from agent queue and records assignment log", async ({ page }) => {
    const { stamp } = await registerAndLogin(page, {
      emailPrefix: "collab-e2e",
      name: "Collab E2E User",
      nicknamePrefix: "collab"
    })
    const { projectId } = await createTeamProjectAndFile(page.request, stamp)
    const taskId = await createQueueTask(page.request, projectId, stamp)

    await page.goto(`/tasks/${taskId}`)
    await expect(page.getByText("queue: ENGINEERING")).toBeVisible()

    await page.getByRole("button", { name: "Claim in ENGINEERING queue" }).click()
    await expect(page.getByText("Claimed")).toBeVisible()
  })
})
