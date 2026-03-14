# Task Assignment Integration Guide

This guide is for frontend/manual integration of the Sprint 1 task assignment flow.

## 1. Recommended flow

1. Create task with optional `specMarkdown`.
2. Request top suggestion from `POST /api/tasks/{id}/suggest-assignee`.
3. Confirm assignment with `POST /api/tasks/{id}/assign`.
4. Optional self-claim via `POST /api/tasks/{id}/claim` (human or agent queue).
5. Trigger execution for agent task via `POST /api/tasks/{id}/run-agent`.
6. For autonomous agents, pull queue task via `POST /api/tasks/agent-queue/pull`.
7. For AI auto mode, trigger batch dispatch via `POST /api/tasks/auto-dispatch`.
8. Render operations metrics from `GET /api/tasks/metrics`.
9. Render assignment timeline from `GET /api/tasks/{id}` -> `assignmentLogs`.

## 2. API examples

### 2.1 Create task with TaskSpec

`POST /api/tasks`

```json
{
  "projectId": "proj_xxx",
  "title": "Implement notification retry",
  "description": "Stabilize email retries",
  "specMarkdown": "# TaskSpec\n\n## Goal\n- ...\n\n## Deliverables\n- ...\n\n## Requirements\n- ...\n\n## Acceptance Criteria\n- ...\n\n## Priority\n- HIGH",
  "assignmentMode": "MANUAL",
  "assigneeType": "HUMAN",
  "assigneeId": "user_xxx"
}
```

Note: You can create an unassigned task by omitting `assigneeId` when `assigneeType` is `HUMAN`.

Task list API (`GET /api/tasks`) now includes `latestAgentRun` per task when available:

```json
{
  "latestAgentRun": {
    "status": "FAILED",
    "triggeredAt": "2026-03-12T10:20:00.000Z",
    "executionId": "exec_2",
    "error": "timeout"
  }
}
```

It also includes `specQualityScore` (`0..100`) when `specMarkdown` exists.

Risk scoring fields are also returned:

```json
{
  "riskScore": 75,
  "riskLevel": "HIGH",
  "riskReasons": [
    "Due within 24 hours",
    "Latest agent run failed"
  ]
}
```

Task detail API (`GET /api/tasks/{id}`) also includes:
- `specQualityScore`
- `riskScore`
- `riskLevel`
- `riskReasons`

### 2.2 Suggest assignee

`POST /api/tasks/{id}/suggest-assignee`

```json
{
  "topN": 3,
  "weights": {
    "agentDomainMatch": 0.5,
    "workload": 0.3,
    "deadlineRisk": 0.2
  }
}
```

Selection behavior:

- Active agents are considered.
- Online agents (recent heartbeat) are prioritized over idle agents.
- Response includes `dispatchPolicy.onlineOnly`.
- Agent suggestions include `agentOnline` for `FUNCTIONAL_AGENT` candidates.

### 2.3 Confirm assignment

`POST /api/tasks/{id}/assign`

```json
{
  "assigneeType": "FUNCTIONAL_AGENT",
  "functionalAgentType": "ENGINEERING",
  "agentId": "agent_xxx",
  "assignmentMode": "AI_SUGGESTED",
  "source": "suggestion",
  "reason": "Accepted rank #1"
}
```

Policy behavior:

- If project dispatch policy is `onlineOnly=true`, assigning an offline agent is rejected (`AGENT_OFFLINE_BY_POLICY`).

### 2.4 Human self-claim

`POST /api/tasks/{id}/claim`

```json
{
  "assigneeType": "HUMAN",
  "assigneeId": "user_self",
  "reason": "Self-claimed from task list"
}
```

### 2.5 Unassign

`POST /api/tasks/{id}/unassign`

No body required.

### 2.6 Agent queue claim

`POST /api/tasks/{id}/claim`

```json
{
  "assigneeType": "FUNCTIONAL_AGENT",
  "functionalAgentType": "ENGINEERING",
  "reason": "Claimed from agent queue: ENGINEERING"
}
```

### 2.7 Run agent execution

`POST /api/tasks/{id}/run-agent`

```json
{
  "executionNotes": "Triggered from task detail",
  "autoSubmit": true,
  "idempotencyKey": "run-task-123-attempt-1"
}
```

Response includes:

- `taskId`
- `executionId`
- `deliverable` (`id`, `name`, `status`, `createdAt`)
- `status` (task status after trigger, usually `IN_PROGRESS`)

Execution strategy (current implementation):

- `ENDPOINT`: call agent `apiEndpoint` with timeout protection
- `MODEL`: call model using agent `apiKeyEncrypted` + `modelConfig`
- `RULE_BASED`: deterministic fallback when no runnable agent endpoint/model is available
- endpoint/model execution includes retry (best-effort) for transient failures
- per-task safety guard:
  - run conflict window: 60 seconds
  - run rate limit: 5 runs per hour
- if `idempotencyKey` is repeated in the same task window, API returns deduplicated response

### 2.8 Agent queue pull + claim protocol

`POST /api/tasks/agent-queue/pull`

Headers:

- `x-agent-id: <agent_id>`
- `Authorization: Bearer <agent_key>` (or `x-agent-key`)

Body:

```json
{
  "projectId": "proj_xxx",
  "functionalAgentType": "ENGINEERING",
  "claim": true
}
```

Agent heartbeat API:

- `POST /api/agents/heartbeat`
- Headers:
  - `x-agent-id: <agent_id>`
  - `Authorization: Bearer <agent_key>`
- Used by autonomous agents to report liveness.

### 2.9 AI_AUTO batch dispatch

`POST /api/tasks/auto-dispatch`

```json
{
  "projectId": "proj_xxx",
  "limit": 5,
  "autoSubmit": true,
  "idempotencyKey": "dispatch-proj-xxx-20260312-001",
  "taskIds": ["task_a", "task_b"]
}
```

Dispatch behavior:

- For `FUNCTIONAL_AGENT` queue tasks, dispatcher selects preferred agent with online-first strategy.

### 2.10 Operations metrics

`GET /api/tasks/metrics?projectId=proj_xxx&days=14`

Response highlights:

- queue backlog total + grouped by agent queue domain
- execution runs / success / failures / successRate
- average completion hours for completed agent tasks
- top failure reasons
- `dispatchHistory`: recent auto-dispatch batch history (time/mode/total/success/failed)
  - includes failed task summaries with `taskId`, `error`, `errorCode`
- `retryableErrorCodes`: backend-defined list used by UI for smart retry filtering
- `dispatchPolicyOnlineOnly`: current dispatch policy (`true/false/null`)
- `dispatchPolicySource`: `project | default | mixed`
- `risk`: high-risk due-date snapshot:
  - `overdue`
  - `dueIn24h`
  - `dueIn3d`
  - `total`

### 2.10.1 Agent queue status

`GET /api/agents/queue-status?projectId=proj_xxx`

- Returns per-domain queue backlog and agent availability:
  - `backlog`
  - `activeAgents`
  - `onlineAgents`

### 2.10.2 Operations status

`GET /api/operations/status?sourceProjectId=proj_xxx`

- Returns unified 24h operations snapshot:
  - queue backlog totals + per-domain breakdown
  - scheduler batches started/completed
  - auto-dispatch success/failure
  - agent run triggered/failed
  - saved report throughput and top report types
- Supports `format=markdown`.

`POST /api/operations/status/save`

- Saves operations status markdown report into target project file.

### 2.11 Rejection re-queue behavior

`POST /api/deliverables/{id}/review` with `status=REJECTED`

Behavior:

- If task is on agent flow (`assigneeType != HUMAN`), the task is automatically re-queued:
  - `status -> PENDING`
  - `assigneeType -> FUNCTIONAL_AGENT`
  - `agentId/assigneeId/claimedAt -> null`
  - reviewer feedback is appended into TaskSpec under `Revision Request`
- Response contains:
  - `requeue.requeued` (`true/false`)
  - `requeue.queueDomain` when re-queued

### 2.12 Project scheduler trigger

`POST /api/tasks/scheduler/trigger`

Trigger modes:

- `MANUAL`: authenticated project editor/admin
- `SCHEDULED`: header `x-scheduler-token` matches `TASK_SCHEDULER_TOKEN`

Request:

```json
{
  "projectId": "proj_xxx",
  "limit": 5,
  "autoSubmit": true,
  "idempotencyKey": "dispatch-proj-xxx-20260312-001"
}
```

Behavior:

- Reuses AI auto-dispatch logic (queue resolve, runtime execute, deliverable create).
- Supports batch deduplication and conflict guard.
- `taskIds` is optional; when provided, scheduler only retries/runs those tasks.
- Returns `triggerMode` in response.

### 2.13 Project retry config API

`GET /api/projects/{id}/retry-config`

- Returns current project-level retryable error code config
- Includes `availableRetryableErrorCodes`

`PATCH /api/projects/{id}/retry-config`

```json
{
  "retryableErrorCodes": [
    "AGENT_EXECUTION_TIMEOUT",
    "AGENT_ENDPOINT_ERROR",
    "AGENT_RUN_CONFLICT"
  ]
}
```

- Requires project `EDITOR+`
- Writes config as auditable project activity event
- You can reset to defaults:

```json
{
  "resetToDefault": true
}
```

### 2.14 Project scheduler config API

`GET /api/projects/{id}/scheduler-config`

- Returns project-level scheduler defaults:
  - `enabled`
  - `defaultLimit`
  - `defaultAutoSubmit`

### 2.14.1 Project dispatch policy API

`GET /api/projects/{id}/dispatch-policy`

- Returns project-level dispatch policy:
  - `onlineOnly`

`PATCH /api/projects/{id}/dispatch-policy`

```json
{
  "onlineOnly": true
}
```

- When `onlineOnly=true`, assignee suggestions and auto-dispatch/scheduler only use online agents.

`PATCH /api/projects/{id}/scheduler-config`

```json
{
  "enabled": true,
  "defaultLimit": 5,
  "defaultAutoSubmit": true
}

### 2.15 Create task from markdown file

`POST /api/files/{id}/tasks`

Create a task directly from an existing markdown file in the workspace.

Request:

```json
{
  "title": "Task from Architecture Doc"
}
```

Behavior:

- Requires project `EDITOR+` permission.
- Generates TaskSpec from file markdown when `specMarkdown` is not provided.
- Records source metadata in activity log:
  - `type=TASK_CREATED_FROM_FILE`
  - `sourceFileId`
  - `sourceFileName`

Response:

```json
{
  "task": {
    "id": "task_xxx",
    "title": "Task from Architecture Doc"
  },
  "source": {
    "fileId": "file_xxx",
    "fileName": "Architecture.md"
  }
}
```

Related query API:

- `GET /api/files/{id}/tasks`
- Returns task list linked to this source file (newest first)
- `GET /api/files/{id}/tasks-report`
- Returns linked-task report payload + markdown
- `GET /api/files/{id}/tasks-report?format=markdown`
- Returns pure markdown report for download/export
- `POST /api/files/{id}/tasks-report/save`
- Saves linked-task report as a project markdown file (requires `EDITOR+`)
- `GET /api/tasks?sourceFileId={fileId}`
- Filters task list by source markdown file

Bulk create API:

- `POST /api/files/tasks/bulk`
- Creates tasks from multiple markdown files in one call.
- Request:

```json
{
  "fileIds": ["file_a", "file_b"],
  "skipIfLinkedTaskExists": true
}
```

- Response includes:
  - `createdCount`, `skippedCount`
  - `created[]` with task/file mapping
  - `skipped[]` with reasons (for example `LINKED_TASK_ALREADY_EXISTS`)

### 2.16 Workspace markdown report

`GET /api/projects/{id}/workspace-report`

- Returns project collaboration snapshot and markdown content.
- Includes `Recent Agent Runs` section in markdown and `metrics.recentAgentRuns` in JSON payload.
- Includes `High Risk Tasks (Due <= 3 days)` section in markdown and `metrics.highRiskTasks`.
- Includes `Agent Dispatch Policy`, `At-Risk Queue Domains`, and `Bottleneck Recommendations`:
  - markdown sections for fast review
  - JSON fields:
    - `metrics.dispatchPolicy`
    - `metrics.atRiskDomains`
    - `metrics.bottleneckRecommendations`

`GET /api/projects/{id}/workspace-report?format=markdown`

- Returns pure markdown (`text/markdown`) for direct download/export.

`POST /api/projects/{id}/workspace-report/save`

- Saves current workspace report as a markdown file inside the same project.
- Requires project `EDITOR+`.

### 2.17 Task agent run history

`GET /api/tasks/{id}/runs`

- Returns normalized agent execution history for a task.
- Optional query:
  - `limit` (default `20`, range `1..100`)

Response:

```json
{
  "taskId": "task_xxx",
  "total": 2,
  "runs": [
    {
      "executionId": "exec_1",
      "status": "SUCCESS",
      "triggeredAt": "2026-03-12T10:10:00.000Z",
      "triggeredBy": {
        "id": "user_xxx",
        "name": "Alice",
        "email": "alice@example.com"
      },
      "targetAgent": "eng-agent",
      "runtimeMode": "ENDPOINT",
      "deliverableId": "del_1",
      "error": null,
      "idempotencyKey": "idem_1"
    },
    {
      "executionId": "exec_2",
      "status": "FAILED",
      "triggeredAt": "2026-03-12T10:20:00.000Z",
      "triggeredBy": {
        "id": "user_xxx",
        "name": "Alice",
        "email": "alice@example.com"
      },
      "targetAgent": null,
      "runtimeMode": null,
      "deliverableId": null,
      "error": "timeout",
      "idempotencyKey": null
    }
  ]
}
```

### 2.18 TaskSpec lint API

`POST /api/tasks/spec-lint`

Analyze TaskSpec markdown quality (structure + placeholder checks) and return score/issues.

Request:

```json
{
  "markdown": "# TaskSpec\n\n## Goal\n- ...\n..."
}
```

### 2.19 Agent workload API

`GET /api/agents/workload`

- Returns 24h (or custom window) per-agent workload + run reliability snapshot.
- Query:
  - `projectId` (optional): scope by project (requires project membership)
  - `hours` (optional): analysis window, `1..168`, default `24`

### 2.20 Agent detail diagnostics

`GET /api/agents/{id}`

- Returns:
  - `isOnline`
  - `diagnostics.taskStatus`
  - `diagnostics.recentRuns`
  - `diagnostics.queuePressure`

### 2.21 Project bottlenecks API

`GET /api/projects/{id}/bottlenecks`

- Returns:
  - `queueBacklog` (domain backlog + online agents)
  - `atRiskDomains` (backlog > 0 and online agents = 0)
  - `highRiskTasks` (top high-risk tasks with reasons)
  - `recommendations` (actionable next steps)
- Query:
  - `format=markdown` to return `text/markdown` report for export

`POST /api/projects/{id}/bottlenecks/save`

- Saves current bottlenecks report as a markdown file under the project.
- Requires project `EDITOR+`.

`POST /api/projects/{id}/bottlenecks/remediation-tasks`

- Creates remediation tasks from current bottlenecks recommendations.
- Requires project `EDITOR+`.
- Optional request fields:
  - `limit` (`1..10`, default `5`)
  - `applyDispatchFallback` (`true/false`, default `true`):
    - when true and at-risk queue domains exist, if project dispatch policy is `onlineOnly=true`,
      backend automatically records a policy update to `onlineOnly=false` for emergency fallback.

Response also includes optional `dispatchPolicyUpdate`:

```json
{
  "dispatchPolicyUpdate": {
    "changed": true,
    "previousOnlineOnly": true,
    "onlineOnly": false,
    "reason": "Disabled online-only dispatch because at-risk queue domains were detected"
  }
}
```

Response:

```json
{
  "valid": true,
  "score": 84,
  "issues": [
    {
      "level": "warning",
      "code": "MISSING_DUE_DATE",
      "message": "Due Date section is recommended"
    }
  ],
  "sectionStats": [
    { "section": "Goal", "bullets": 2 }
  ]
}
```
```

Reset:

```json
{
  "resetToDefault": true
}
```

Scheduler behavior:

- `POST /api/tasks/scheduler/trigger` uses project defaults when `limit/autoSubmit` are omitted.
- If project scheduler is disabled, trigger returns `SCHEDULER_DISABLED`.
- UI retry behavior:
  - `Retry failed tasks` only retries runtime-retryable failures
  - currently retryable: `AGENT_EXECUTION_TIMEOUT`, `AGENT_ENDPOINT_ERROR`, `AGENT_RUN_CONFLICT`
  - project-level retry policy is configured in **Project Detail -> Agent Retry Policy**
  - project list includes **Bulk Scheduler Runner** for concurrent multi-project trigger
  - Bulk Scheduler Runner supports scope filter: `All` / `Custom policy` / `Default policy`
  - Bulk Scheduler Runner supports one-click `Retry failed projects` from the previous batch
  - Bulk Scheduler Runner can export results as Markdown (`Copy Report` / `Download .md`)
  - Bulk Scheduler Runner keeps last run result in browser local storage for quick recovery after refresh
  - project list includes **Cross-Project Scheduler History** with one-click retry of failed task set

Behavior:

- Select pending tasks where `assignmentMode=AI_AUTO`.
- Resolve queue task (`FUNCTIONAL_AGENT`) to an active agent (capability match + fallback).
- Execute each task via runtime.
- Create deliverable and return per-task success/failed result.
- batch guard:
  - deduplicate by `idempotencyKey` (24h window)
  - conflict protection for overlapping batch start (60s window)

Response summary:

```json
{
  "projectId": "proj_xxx",
  "total": 3,
  "successCount": 2,
  "failedCount": 1,
  "results": [
    { "taskId": "task_1", "status": "SUCCESS", "executionId": "...", "deliverableId": "..." },
    { "taskId": "task_2", "status": "FAILED", "executionId": "...", "error": "..." }
  ]
}
```

Behavior:

- `claim=true` (default): pull next queue task and atomically claim it.
- `claim=false`: peek the next queue task without state mutation.

Success response:

```json
{
  "task": {
    "id": "task_xxx",
    "title": "Implement queue worker",
    "status": "IN_PROGRESS",
    "assigneeType": "AGENT",
    "agentId": "agent_xxx",
    "functionalAgentType": "ENGINEERING"
  },
  "claimed": true,
  "agentId": "agent_xxx",
  "queueDomain": "ENGINEERING"
}
```

## 3. Common error codes

- `TASK_NOT_FOUND`: target task does not exist.
- `NOT_PROJECT_MEMBER`: current user is not in target project.
- `INSUFFICIENT_PERMISSIONS`: operation requires editor/admin role.

## 4. Template management API

- `GET /api/templates/{id}`
  - Returns template detail.
  - Access: public templates or creator-owned templates.
- `PATCH /api/templates/{id}`
  - Updates template fields (`name`, `description`, `category`, `content`, `isPublic`).
  - Access: creator only.
  - Built-in templates are read-only (`BUILTIN_TEMPLATE_READ_ONLY`).
- `DELETE /api/templates/{id}`
  - Deletes a custom template.
  - Access: creator only.
  - Built-in templates are protected (`BUILTIN_TEMPLATE_READ_ONLY`).

## 5. Team member bulk-add API

- `POST /api/teams/{id}/members/bulk-add`
- Add multiple users by email in one call (admin only).

Request:

```json
{
  "emails": ["a@example.com", "b@example.com"],
  "role": "MEMBER"
}
```

Response includes:
- `addedCount`
- `alreadyMemberCount`
- `notFoundCount`
- `addedEmails`, `alreadyMemberEmails`, `notFoundEmails`

Team page integration updates:
- Team detail now includes a `Team Overview` block:
  - `Projects`
  - `Files`
  - `Open Tasks`
  - `Due <= 3d`
  - `Overdue`

## 6. Project template recommendations API

- `GET /api/projects/{id}/template-recommendations`
- Returns template suggestions for file creation based on project historical template usage.
- Response:
  - `recommendationSource`: `project_usage | builtin_fallback`
  - `categories`: ranked template categories
  - `templates`: recommended template list

## 7. Project creation with starter files

- `POST /api/projects`
- Supports optional `starterTemplateIds` to auto-create initial project markdown files.

Request:

```json
{
  "name": "Project Alpha",
  "teamId": "team_xxx",
  "description": "Optional",
  "starterTemplateIds": ["tpl_charter", "tpl_tech_design"]
}
```

Behavior:
- Creates the project as usual.
- For each permitted template ID, creates one starter file in the new project.
- Returns `starterTemplatesApplied` in response.
- UI supports one-click packs:
  - `PM Starter`
  - `IT R&D Starter`

Starter pack API:

- `GET /api/templates/starter-packs`
- Returns:
  - `packs`: pack definitions with template IDs
  - `templates`: built-in templates used for pack derivation

Apply starter files to existing project:

- `POST /api/projects/{id}/starter-files`
- Request:

```json
{
  "templateIds": ["tpl_a", "tpl_b"],
  "skipExistingByTemplateType": true
}
```

- Requires project `EDITOR+`.
- Response includes:
  - `createdCount`, `skippedCount`
  - `created[]`, `skipped[]`

Apply starter pack directly:

- `POST /api/projects/{id}/starter-files/apply-pack`
- Request:

```json
{
  "packId": "PM_STARTER",
  "skipExistingByTemplateType": true,
  "dryRun": false
}
```

- Supported `packId`:
  - `PM_STARTER`
  - `IT_RD_STARTER`
  - `OPS_INCIDENT_STARTER`

Bulk apply starter pack:

- `POST /api/projects/starter-files/bulk-apply-pack`
- Request:

```json
{
  "packId": "PM_STARTER",
  "projectIds": ["proj_a", "proj_b"],
  "skipExistingByTemplateType": true,
  "dryRun": true
}
```

- Response includes per-project result rows and summary:
  - `successCount`
  - `failedCount`
  - `results[]`
  - `dryRun`

Team bulk apply starter pack:

- `POST /api/teams/{id}/starter-files/apply-pack`
- Request:

```json
{
  "packId": "PM_STARTER",
  "projectIds": ["proj_a", "proj_b"],
  "skipExistingByTemplateType": true,
  "dryRun": true
}
```

- Requires team `ADMIN`; each target project also requires `EDITOR+` membership.
- Response includes:
  - `teamId`
  - `successCount`
  - `failedCount`
  - `results[]`
  - `dryRun`

Team starter pack history:

- `GET /api/teams/{id}/starter-files/history`
- Returns recent team-level starter-pack apply logs (across team projects):
  - `projectId`, `projectName`
  - `packId`, `packName`
  - `scope` (`team_bulk`)
  - `dryRun`
  - `createdCount`, `wouldCreateCount`, `skippedCount`
  - `createdAt`, `actor`

Workspace-level report:

- `GET /api/workspace/report`
- Query:
  - `format=markdown` to return markdown directly
- Returns workspace-wide summary for current user scope:
  - team/project/file counts
  - active/online agent counts
  - task status snapshot
  - recent projects
  - recent auto-dispatch batches

Workspace-level save:

- `POST /api/workspace/report/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "fileName": "optional-custom-report-name.md"
}
```

- Behavior:
  - Generates workspace report markdown for current user scope.
  - Saves markdown as a project file (`CUSTOM` + `WORKSPACE_REPORT`) into:
    - requested `projectId` if provided and editable, otherwise
    - latest editable member project.

Agent workload save:

- `POST /api/agents/workload/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "hours": 24,
  "fileName": "optional-agent-workload-report.md"
}
```

- Behavior:
  - Generates agent workload markdown report for selected project scope.
  - Saves markdown as a project file (`CUSTOM` + `AGENT_WORKLOAD_REPORT`).

Templates catalog save:

- `POST /api/templates/catalog/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "fileName": "optional-templates-catalog.md"
}
```

- Behavior:
  - Generates templates catalog markdown report for current user-visible templates.
  - Includes built-in/custom markers and usage counters.
  - Saves markdown as a project file (`CUSTOM` + `TEMPLATES_CATALOG`).

Files inventory save:

- `POST /api/files/inventory/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "sourceProjectId": "optional_scope_project_id",
  "fileName": "optional-files-inventory.md"
}
```

- Behavior:
  - Generates files inventory markdown report for accessible projects (or specified source project).
  - Includes linked task counters per file.
  - Saves markdown as a project file (`CUSTOM` + `FILES_INVENTORY_REPORT`).

Teams overview save:

- `POST /api/teams/overview/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "fileName": "optional-teams-overview.md"
}
```

- Behavior:
  - Generates teams overview markdown report for current user-visible teams.
  - Includes members/projects counters per team.
  - Saves markdown as a project file (`CUSTOM` + `TEAMS_OVERVIEW_REPORT`).

Projects portfolio save:

- `POST /api/projects/portfolio/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "sourceProjectIds": ["optional_scope_project_id_1", "optional_scope_project_id_2"],
  "fileName": "optional-projects-portfolio.md"
}
```

- Behavior:
  - Generates projects portfolio markdown report for accessible projects (or provided source set).
  - Includes team/status/files/members/updatedAt fields per project.
  - Saves markdown as a project file (`CUSTOM` + `PROJECTS_PORTFOLIO_REPORT`).

Tasks report save:

- `POST /api/tasks/report/save`
- Request:

```json
{
  "projectId": "optional_target_project_id",
  "sourceProjectId": "optional_scope_project_id",
  "status": "optional_task_status",
  "fileName": "optional-tasks-report.md"
}
```

- Behavior:
  - Generates tasks markdown report for accessible projects (or selected source project).
  - Supports optional status filter.
  - Saves markdown as a project file (`CUSTOM` + `TASKS_REPORT`).

Starter pack history:

- `GET /api/projects/{id}/starter-files/history`
- Returns recent starter-pack apply logs for this project:
  - `packId`, `packName`
  - `scope` (`single` / `bulk`)
  - `dryRun`
  - `createdCount`, `wouldCreateCount`, `skippedCount`
  - `createdAt`, `actor`
- `INVALID_REQUEST_PAYLOAD`: request schema validation failed.
- `INVALID_ASSIGNMENT_PAYLOAD`: assignee/agent payload does not satisfy rules.
- `TASK_ALREADY_CLAIMED`: claim attempted on already claimed in-progress task.
- `TASK_NOT_CLAIMABLE`: task status is completed/cancelled.
- `TASK_NOT_AGENT_EXECUTABLE`: task is human-owned or already completed/cancelled.
- `AGENT_AUTH_REQUIRED`: missing `x-agent-id` or key header.
- `AGENT_AUTH_INVALID`: invalid agent id/key combination.
- `AGENT_INACTIVE`: agent is inactive.
- `AGENT_QUEUE_CLAIM_CONFLICT`: queue claim race, caller should pull again.
- `AGENT_NOT_AVAILABLE`: assigned agent missing or inactive.
- `AGENT_EXECUTION_TIMEOUT`: endpoint execution timed out.
- `AGENT_ENDPOINT_ERROR`: endpoint call failed.
- `AUTO_DISPATCH_NO_AGENT`: no active agent available for queue task.
- `AGENT_RUN_CONFLICT`: another run was triggered recently for same task.
- `TASK_RUN_RATE_LIMITED`: task reached run limit in recent one-hour window.
- `AUTO_DISPATCH_CONFLICT`: another auto-dispatch batch started recently.

## 4. UI integration notes

- Disable action buttons while request is pending.
- Show server `error` string directly in toast/banner.
- For AI assignment, use:
  1. `suggest-assignee` with `topN=1`
  2. send returned top item to `/assign`
- Keep manual assign dialog as fallback.
- For agent queue tasks (`assigneeType=FUNCTIONAL_AGENT` + `functionalAgentType`), claim action can directly call `/claim` with `FUNCTIONAL_AGENT`.
- For runnable agent tasks, call `/run-agent` to create an execution deliverable and append an activity log.
- For autonomous agents, call `/tasks/agent-queue/pull` with `claim=true` to claim next queue task.
- For orchestration workers, call `/tasks/auto-dispatch` to execute a bounded batch of `AI_AUTO` tasks.
- Render `assignmentLogs` as timeline in task detail for full assignment traceability.
- Task list supports batch actions with result panel:
  - bulk claim
  - bulk AI suggest+assign
  - concurrent execution queue (default concurrency: 3)
  - live progress bar (completed/success/failed)
  - cancel running batch (stops pulling new tasks; in-flight requests finish naturally)
  - retry failed items only (reuses original action type per task)
  - retry a single failed row directly in result panel
  - result filter tabs (all / failed / success)
  - failure-reason aggregation (reason + count)
  - click a failure reason chip to filter corresponding failed rows
  - copy selected failure-reason task list as Markdown
  - copy result as Markdown
  - save result as project archive file via `POST /api/files`
  - show clickable archive links to `/editor/{fileId}` after save
- Archive file naming is normalized to avoid collisions:
  - `{project}-task-assignment-batch-report-{ISO-second-stamp}-{nonce}`
  - project segment is sanitized (`[A-Za-z0-9_\\p{L}-]` kept, others replaced)
- Task list supports risk-based triage:
  - risk badges on cards (`LOW|MEDIUM|HIGH`)
  - `Risk` sort
  - risk-level filter (`All / High / Medium / Low`)

## 5. Markdown export entrypoints

The workspace now supports one-click Markdown exports for operational reporting:

- Dashboard:
  - `Export Workspace` (workspace summary: teams/projects/files + recent lists)
  - `Save Workspace` (pick target project + optional filename, then save report into project files)
- Reports Hub (`/reports`):
  - Centralized save-entry UI for workspace/agents/templates/files/teams/projects reports.
- Includes agent queue-status save entry (queue backlog + online capacity).
- Includes operations status save entry (scheduler + queue + run + reports health snapshot).
- Includes template starter-packs save entry (PM/IT/Ops starter pack catalog).
  - Includes team workspace save entry (team-level operational snapshot).
  - Includes project workspace save entry (project-level operational snapshot).
  - Includes project bottlenecks save entry (queue domain bottlenecks + high-risk tasks).
  - Includes team starter-pack history save entry (cross-project rollout history by team).
  - Includes project starter-pack history save entry (single-project starter apply history).
  - Includes file linked-tasks save entry (select source file, generate linked task report).
  - Includes recent generated report history with direct file links.
  - Supports history filters by `type`, `project`, and search query.

Reports history API:

- `GET /api/reports/history`
- Query:
  - `type` (optional report type)
  - `projectId` (optional project scope)
  - `q` (optional keyword search)
  - `limit` (optional, default 50, max 200)
  - `format=markdown` (optional markdown response)
- `POST /api/reports/history/save`
- Request:

```json
{
  "targetProjectId": "optional_target_project_id",
  "type": "optional_report_type",
  "projectId": "optional_scope_project_id",
  "q": "optional_search_keyword",
  "limit": 50,
  "fileName": "optional-reports-history.md"
}
```

- Behavior:
  - Saves filtered reports history as markdown into the target project.
  - Records save activity with metadata type `REPORTS_HISTORY_SAVED`.
  - Reports Hub includes `Save History` to persist current filter scope directly.

Additional report-save APIs:

- `POST /api/agents/queue-status/save`
  - Save agent queue backlog/capacity report into a project file.
- `POST /api/operations/status/save`
  - Save operations status report into a project file.
- `GET /api/teams/{id}/workspace-report`
  - Returns team workspace report data.
  - Supports `?format=markdown` for markdown export.
- `POST /api/teams/{id}/workspace-report/save`
  - Save team workspace operational snapshot into a team project file.
- `POST /api/teams/starter-files/history/save`
  - Save team starter-pack rollout history into a project file.
- `POST /api/projects/starter-files/history/save`
  - Save project starter-pack apply history into a project file.
- `GET /api/teams/{id}/starter-files/history`
  - Returns team starter-pack history rows.
  - Supports `?format=markdown` for markdown export.
- `GET /api/projects/{id}/starter-files/history`
  - Returns project starter-pack history rows.
  - Supports `?format=markdown` for markdown export.
- `POST /api/templates/starter-packs/save`
- Save PM/IT/Ops starter packs composition catalog into a project file.
- Projects page:
  - `Export Portfolio` (project portfolio snapshot for current filtered set)
- Teams page:
  - `Export Teams` (team catalog summary)
- Team detail page:
  - `Export Team Report` (team overview + projects + recommended templates)
- Templates page:
  - `Export Templates` (template catalog summary)
  - `Save Starter Packs` (starter packs composition catalog report)
  - Template card action: `Export as Markdown`
- Files page:
  - `Export Inventory` (file inventory + linked-task risk summary)
- Tasks list:
  - `Export Tasks` (current filtered task set with status/priority/risk/assignee)
  - `Save Report` (save current filtered task report into each project archive as markdown files)
- Projects page cards now show cross-project bottlenecks summary:
  - at-risk queue domains count
  - high-risk task count

## 5. Terminology Compatibility

- Product/UI term: **Agent Queue** / **Agent Domain**
- Protocol field (backward compatibility): `functionalAgentType`
- Enum value (backward compatibility): `FUNCTIONAL_AGENT`
- Suggestion weights compatibility:
  - preferred: `agentDomainMatch`
  - legacy (still accepted): `functionalMatch`
