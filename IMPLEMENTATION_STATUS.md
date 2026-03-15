# Implementation Status

Last updated: 2026-03-14

## Current Completion

Estimated overall completion: ~95%

## Completed Core Scope

### Platform Foundation
- Next.js 16 + TypeScript + Tailwind workspace is in place.
- Prisma schema covers users, teams, projects, files, templates, tasks, agents, deliverables, logs, and permissions.
- Auth + RBAC guards are active for page and API access.

### Human-Agent Task Collaboration
- Task lifecycle is implemented (create, assign, claim, run, review, complete, reopen).
- Deliverable manual submission is available from task detail, with review/approve/reject loop.
- Deliverable rejection now enforces feedback and returns structured 400 validation errors.
- Task claim/review APIs now return structured 400 for empty/invalid JSON payloads (no noisy server parsing errors).
- Task manual queue pull and scheduler trigger APIs now return structured 400 (`INVALID_JSON` / `INVALID_REQUEST`) for malformed payloads.
- Task UI/API error mapping is now centralized in `lib/tasks/api-error.ts`, including new request-validation codes, and reused across task list/detail/assign and operations/queue panels.
- Core task APIs (`/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/status`) now return consistent structured error codes (including `INVALID_JSON` / `INVALID_REQUEST_PAYLOAD`) for frontend recovery and user-facing messaging.
- Added route-level tests for task status update API validation/error behavior (`tests/task-status-route.test.ts`) and expanded task route contract assertions for structured error codes.
- Secondary task orchestration endpoints (`run-agent`, `assign`, `suggest-assignee`, `agent-queue/pull`, `auto-dispatch`) now also return structured `INVALID_JSON` / `INVALID_REQUEST_PAYLOAD` responses with test coverage.
- Task error mapping now includes auth/internal/project-actor/report-save style codes and is reused by Tasks report export/save dialogs for consistent recoverable UX messaging.
- Reports API error mapping is now centralized in `lib/reports/api-error.ts` and applied to operations/queue/workload export/save dialogs for consistent cross-module recovery messaging.
- Reports/files/team/project/templates core export/save dialogs now share the same report error mapping utility, improving cross-page error message consistency.
- Assignment supports human, direct agent, and agent queue modes.
- Queue pull/dispatch flows exist for manual and scheduler-triggered operations.
- TaskSpec markdown flow is implemented with lint/quality checks.

### Markdown-Centric Project Workspace
- Files can be created/imported/edited/versioned and linked to tasks.
- Reports can be exported/saved as markdown artifacts into project files.
- Cross-module reporting is implemented for workspace, tasks, agents, files, teams, projects, and history.
- Operations status report is implemented (scheduler/queue/agent-run/report pipeline snapshot).
- Operations health API and health banner are implemented (HEALTHY/DEGRADED/CRITICAL with issue list).
- Dashboard, Tasks, and Agents pages now expose operations status panel + export/save entrypoints.

### Templates and Starter Packs
- Template center supports built-in + custom templates.
- Built-in PM / IT R&D / Ops Incident starter packs are implemented.
- Pack rollout is available for project-level and team-level apply flows.
- Rollout history + summary APIs and report actions are implemented.

### Team and Project Operations
- Team/project list and management pages are available.
- Team/project report exports and save-to-file flows are available.
- Projects bottleneck analysis and remediation task generation are implemented.

### Reliability and Coverage
- Route-level and utility tests exist for key task/report/template/portfolio/history features.
- Current incremental changes pass `npx tsc --noEmit` and targeted Jest suites.
- Playwright E2E now covers auth pages, protected-route redirects, and operations-status entry flow after sign-in.
- Playwright E2E now also validates report-dialog default propagation from URL filters (tasks/reports).
- Playwright E2E now validates files inventory export/save default project scope propagation.
- Playwright E2E now validates teams/projects report-dialog default propagation from URL filters.
- Playwright E2E now validates reports history export/save propagation for `page/limit` defaults.
- E2E auth setup for reports/operations suites now uses resilient register-login fallback flow to reduce flaky redirect timeouts.
- E2E register-login helper is centralized under `e2e/helpers/auth.ts` and reused across core suites for maintainability and consistency.
- Operations status E2E now validates entry visibility on Dashboard, Tasks, Agents, Reports, Projects, Teams, Files, and Templates pages.
- Playwright E2E now validates starter-pack bulk runner request flow from Projects page.
- Playwright E2E now validates real starter-pack apply flow (`/api/projects/:id/starter-files/apply-pack`) and file materialization.
- Playwright E2E now validates markdown-file to task creation flow (`/files` -> `/tasks/:id`).
- Playwright E2E now validates deliverable submit + approve loop from task detail.
- Playwright E2E now validates deliverable reject -> task requeue -> revision appendix flow.
- Playwright E2E now validates task claim loop from agent queue.
- Task operations and queue panels now support background refresh with stale-data fallback and manual retry actions.
- Agent queue console now supports resilient agent-list loading with timeout/retry, manual refresh, and last-updated visibility.
- Tasks page project filter now uses resilient project-list loading (timeout/retry + inline recoverable error + manual refresh button).
- Route-level tests cover operations health evaluation route behavior.
- Route-level tests cover deliverable list/create APIs.
- Route-level tests cover deliverable review validation behavior.
- Tasks and Agents pages enforce server-side auth redirect to `/login`.
- Reports history query logic is centralized across page/export/save flows with reduced scan window for better high-volume performance.
- Reports history API supports page/limit pagination and Reports Hub provides previous/next navigation.
- Reports history pagination now uses explicit `hasMore` detection to avoid false-positive next-page navigation.
- Reports history export/save actions now support current-page scope (`page`) to align artifacts with active list view.
- Reports Hub now supports configurable history page size (`limit`) and propagates it to pagination/export/save workflows.
- Save Reports History dialog now defaults Target Project to the current reports project scope when available.
- Reports history query now supports deeper pagination windows with bounded scan limits, reducing false-empty pages on larger page numbers.
- Save Reports History dialog now reuses loaded project options across re-open operations to reduce repeated project-list fetches.
- Task metrics API now uses bounded activity-log scan, backlog group aggregation, and risk count queries for improved high-volume performance.
- Task operations and queue panels now pause auto-refresh when tab is hidden and prevent overlapping fetch loops.
- Operations status panel now has the same resilient fetch model (background refresh, stale-data fallback, manual refresh, page-visibility pause, in-flight guard).
- Team starter rollout history panel now supports resilient manual refresh and stale-data fallback UX with last-updated visibility.
- Project starter files panel now supports resilient manual refresh with stale-data fallback and last-updated visibility.
- Projects/Teams/Files pages now expose the same operations health + status panels with optional project-scoped filtering for cross-page observability consistency.
- Operations health banner now supports retry, background refresh, manual refresh, stale-data fallback, and page-visibility-aware polling.
- Reports and Templates pages now also expose the unified operations health + status panels to complete cross-workspace observability coverage.
- Starter-pack and template UI actions now use shared structured API error mapping (code-aware) across project/team/template panels, reducing raw backend message leakage and improving UX consistency.
- Project/Team/Templates core panels now fully remove direct `payload?.error` pass-through patterns and use shared error mapping consistently (including scheduler/history/report save dialogs).
- Files/Agents/Operations/Dashboard/Deliverables panels now also use shared error mapping; key paths (`file task report`, `bulk task create`, `operations health`, `workspace save`) no longer expose raw backend error text.
- Tasks core pages (`tasks-page-client`, `operations-status-panel`, `task-list`, `task-detail`) now consistently use payload-based error mapping utilities; component-level raw backend error passthrough has been eliminated.
- `POST /api/projects` and `/api/deliverables` now return structured error codes for invalid payload, membership, and internal failures, with route tests updated accordingly.
- Team/Agent/File core CRUD routes now return structured error codes for auth, membership, invalid payload, and internal failures; relevant route tests were extended and passing.
- AI generation and auth register endpoints now include structured error codes for key failure states (unauthorized, invalid payload, missing/invalid API key, duplicate user).
- Comments/Notifications/Email verification/Liveblocks auth routes now return structured error codes with targeted Jest coverage to prevent generic "Failed to fetch" regressions.
- Templates and file-versions root APIs now also return structured validation/query/not-found/internal error codes, with dedicated route tests.
- Users/User profile/User API-key routes now use structured auth/validation/not-found/internal codes with dedicated Jest coverage.
- Convert/File export/AI key validation/Fix-schema APIs now return structured error codes; regression tests were added for their key failure branches.
- Settings API-key panel now uses code-aware API error mapping for save/delete/validate flows, reducing generic failure prompts.
- Activity API now enforces project-scope access boundaries (no global log leakage), returns structured error codes, and is covered by route tests.
- MCP endpoint now returns structured error code metadata in JSON-RPC error data for auth/payload/internal failures, with dedicated route tests.
- Agents UI error handling was hardened for config/edit/detail/list flows (code-aware messages), and regenerate-key action now uses the correct API route.
- Notification center, agent workload overview, and version history panels now surface code-aware errors with visible retry UX instead of silent console-only failures.
- Comments panel and task-creation dialog now use code-aware API error mapping with visible retry/error UX (including project/user/agent option loading failures).
- Create-file dialog and template card project-loading paths now use code-aware API error handling instead of hardcoded generic errors.
- Agent create dialog now also uses code-aware backend error mapping, aligning create/edit/config/list error UX.
- Reports/portfolio/inventory export-save dialogs removed remaining hardcoded "Failed to load projects/teams/files" fetch branches in favor of code-aware payload mapping.
- User-facing terminology pass updated "Agent Role Queue" wording to "Agent Queue" across pages and generated report text.
- Auth/Settings/Team/Task assignment high-frequency dialogs now use payload-based API error mapping and preserve runtime error messages in catch branches instead of generic "Please try again" fallbacks.
- Residual hardcoded `Please try again` / `data.error || ...` patterns in `components/*` were fully removed; frontend error UX now consistently follows code-aware mappers.
- Remaining legacy queue wording in task views/status banners was normalized to `Agent queue` for terminology consistency.
- Agent Queue Console now matches other operations panels with page-visibility-aware auto-refresh, stale-snapshot fallback messaging, and explicit empty-state guidance for missing active agents/domain matches.
- Core collaboration Playwright flow (`e2e/collab-core-flow.spec.ts`) is green end-to-end (6/6): starter-pack bootstrap, bulk runner, markdown-to-task, deliverable approve/reject loops, and agent queue claim.
- Operations status Playwright coverage now verifies project-scoped requests and refresh behavior on Reports (`e2e/operations-status.spec.ts`).
- Combined Playwright regression is green across core-collab + operations health/status suites (9/9 passing).
- Added a shared client-side project-options cache (`lib/reports/project-options-cache.ts`) with TTL + in-flight dedup to reduce repeated `/api/projects` fetches in dialog-heavy report/file/template flows.
- Project options cache has been integrated across task/report/file/template/portfolio export-save dialogs; only task list/create keep direct real-time `/api/projects` loading by design.
- Extended Playwright regression with report/file defaults plus core collaboration flow is green after cache rollout (11/11 passing).
- Added dedicated unit tests for project-options cache behavior (`tests/project-options-cache.test.ts`): cache hit, force refresh, and concurrent request dedup.
- Project-creation flow now invalidates project-options cache immediately after successful create (`components/project/create-project-dialog.tsx`), avoiding stale project choices in subsequent dialogs.
- Additional save dialogs (workspace report, teams overview) now use cached project options; component-level direct `/api/projects` requests are now limited to task list/create where real-time refresh is intentionally preserved.
- Added shared team-options cache (`lib/reports/team-options-cache.ts`) and integrated it across team report dialogs and project-creation options loading; component-level direct `/api/teams` requests are now eliminated.
- Added dedicated team-options cache unit tests (`tests/team-options-cache.test.ts`) for cache hit, force refresh, and concurrent request dedup.
- Added shared starter-pack options cache (`lib/reports/starter-pack-options-cache.ts`) with TTL + in-flight dedup, and integrated it into project starter panels to reduce repeated `/api/templates/starter-packs` fetches.
- Template create/edit/delete/import flows now clear both template-options and starter-pack caches to prevent stale starter-pack mappings after template catalog updates.
- Project Quick Starter actions now surface explicit loading/error states when starter-pack options fail to load (instead of silent empty rendering), improving team/project UX debuggability.
- Teams/Templates/Workspace/Reports/Files hub export buttons now use inline non-blocking error feedback instead of browser `alert`, aligning export UX with recoverable panel patterns.
- Template editor and markdown importer now surface validation/API failures inline (non-blocking) instead of browser `alert`, improving consistency for template authoring workflows.
- Files/Agents/Project detail/AI assistant flows now also use inline non-blocking error feedback; `components/*` no longer contains blocking browser `alert(...)` calls.
- Added one-command core quality gate (`npm run verify:core`) that runs typecheck + core Jest suite + smoke E2E (`auth` + `operations-status`) for release readiness.
- Added CI workflow (`.github/workflows/ci-core.yml`) with PostgreSQL service, Prisma generate/migrate, Playwright browser install, and `verify:core` execution.
- Playwright config now uses visible reporters (`list/line`) plus explicit webServer timeout, reducing silent hang risk during local/CI regression runs.
- Added new workspace core E2E coverage (`e2e/workspace-core-flows.spec.ts`) for:
  - Template Center apply-to-project flow (`Use Template` -> project select -> create file)
  - Files import flow (`/files/import` upload markdown -> project assignment -> editor redirect)
  - Teams navigation flow (`/teams` list -> `/teams/:id` detail with linked project visibility)
- Added E2E fixture markdown sample (`e2e/fixtures/import-sample.md`) and runnable script `npm run test:e2e:workspace`.
- Added new team rollout E2E coverage (`e2e/team-rollout-flows.spec.ts`) for:
  - Team detail starter-pack bulk preview flow (`/teams/:id` -> bulk runner -> preview request/result)
  - Recommended template quick-use flow (`Use in Project` -> create file -> editor redirect)
- Added runnable script `npm run test:e2e:team`; combined workspace/team suites are green (5/5) and `verify:core` remains green.
- Added `verify:extended` quality gate (core gate + workspace/team deep E2E + collab core flow), now passing locally end-to-end.
- CI core workflow now includes a main-branch-only `verify-extended` job after `verify-core` for stronger release confidence.
- Agent Queue Console now clears stale selected agent IDs when queue domain changes, adds timeout+retry pull behavior, and surfaces domain-match capacity hint for safer claim actions.
- Added queue-specific E2E coverage (`e2e/agent-queue-console.spec.ts`) to verify domain switch clears stale agent selection and claim request payload remains valid (`agentId` omitted when auto-select is restored).
- Added runnable script `npm run test:e2e:queue` (passing).
- Operations Snapshot retry action now clearly targets runtime-retryable failures only: retry button is disabled when retryable count is 0, and row UX reflects retryable filtering.
- Added operations-retry E2E coverage (`e2e/task-operations-retry.spec.ts`) to verify scheduler retry payload includes only retryable task IDs from dispatch-history failures.
- Added runnable script `npm run test:e2e:ops` (passing).
- Files page now distinguishes workspace-onboarding state (`no accessible projects`) from data-empty/filter-empty states, with direct navigation to Teams/Projects.
- Reports Hub now distinguishes workspace-onboarding state (`no accessible projects`) from filter-empty history states, avoiding misleading empty-data messaging.
- Added onboarding E2E coverage (`e2e/onboarding-empty-workspace.spec.ts`) and runnable script `npm run test:e2e:onboarding`.
- Tasks page now distinguishes workspace-onboarding state (`no accessible projects`) from task-list empty states, and gates report/queue/task actions behind project availability.
- Projects page now distinguishes workspace-onboarding state (`no accessible projects`) from filter-empty states (`no projects match your filters`) with explicit reset guidance.
- Teams page now distinguishes true-empty (`no teams yet`) from filter-empty (`no teams match your filters`) and gates report actions until teams exist.
- Templates page now shows explicit quick-apply prerequisites (`no editable projects yet`) and distinguishes template filter-empty states from true-empty.
- Onboarding E2E now covers Files + Reports + Tasks + Projects + Teams + Templates empty workspace entry flow.
- Team template quick-use and team rollout actions now use timeout+retry fetch strategy to reduce transient network failure impact during template application.
- Team rollout and quick-apply buttons now expose disabled-state reasons (`title`) when no eligible project/team targets exist.
- Team members management actions (search/add/bulk/role/remove) now use timeout+retry fetch strategy for transient network failures.
- Added team-members resilience E2E (`e2e/team-members-resilience.spec.ts`) to verify user-search retry path before add-member POST.
- Cross-project bulk runner panels now consistently use timeout+retry fetch strategy (`starter-pack runner`, `scheduler runner`, `scheduler history retry`), reducing transient failure noise.
- Bulk starter-pack and scheduler runner panels now show local snapshot timestamps and support explicit snapshot clearing for execution traceability.
- Added unified bulk-run report save API (`/api/projects/bulk-run-report/save`) with structured report metadata logging for Reports Hub history indexing.
- Bulk starter-pack/scheduler runner archive actions now use the unified save API so archived runner outputs appear in Reports Hub recent history.
- Reports metadata registry now includes dedicated bulk-run report types (`PROJECT_BULK_STARTER_PACK_REPORT_SAVED`, `PROJECT_BULK_SCHEDULER_REPORT_SAVED`) with labels.
- Reports Hub now provides dedicated bulk-run history quick filters (`Bulk Starter Pack History`, `Bulk Scheduler History`) and a `Bulk Runner History` entry card linking to runner console/history views.
- Added E2E coverage for Reports Hub bulk-run quick filters (`e2e/report-defaults.spec.ts`).
- Reports Hub now includes a `Grouped History Snapshot` table (group by report type + project) for current-page history analysis.
- Reports Hub now surfaces current-page KPI cards (`Displayed Records`, `Projects Covered`, `Bulk Runner Records`, `Top Group`) for fast human/agent triage.
- Reports Hub now includes a `Daily Activity Snapshot` mini chart for recent per-day report-save volume on the active page.
- Reports Hub grouped snapshot now supports one-click drill-down (`View records`) to apply report-type/project filters directly from grouped rows.
- Added E2E coverage for grouped-history drill-down links on Reports Hub (`e2e/report-defaults.spec.ts`).
- Template Center now supports server-side pagination (`page/limit`) with retained filter query parameters and previous/next navigation, reducing high-volume template query/render pressure.
- Teams page now supports server-side pagination (`page/limit`) with retained filter query parameters and previous/next navigation.
- Added Teams pagination E2E coverage in workspace core suite (`e2e/workspace-core-flows.spec.ts`).
- Files page now supports server-side pagination (`page/limit`) with retained filter query parameters and previous/next navigation.
- Added Files pagination E2E coverage in workspace core suite (`e2e/workspace-core-flows.spec.ts`).
- Projects page now supports server-side pagination (`page/limit`) with retained filter query parameters and previous/next navigation.
- Added Projects pagination E2E coverage in workspace core suite (`e2e/workspace-core-flows.spec.ts`).
- Agents list now supports client-side pagination controls (`12/24/48 per page`) with filter-aware page reset to reduce heavy-grid rendering pressure.
- Added Agents pagination E2E coverage in workspace core suite (`e2e/workspace-core-flows.spec.ts`).
- Task list now supports client-side pagination controls (`20/50/100 per page`) across list and agent-queue views with filter/sort-aware page reset.
- Added Tasks pagination E2E coverage in workspace core suite (`e2e/workspace-core-flows.spec.ts`).
- Tasks/Agents pagination state now syncs to URL query (`page`, `limit`) for shareable links and refresh persistence.
- Workspace core E2E now validates pagination URL persistence for Agents and Tasks after page reload.
- `/api/tasks` now supports optional server-side pagination/filter/sort query params (`page`, `limit`, `q`, `priority`, `assigneeId`, `assigneeUnassigned`, `assignmentMode`, `sortBy`, `sortOrder`) while preserving backward compatibility when pagination params are omitted.
- Added route-level coverage for tasks list pagination metadata and query-shape filtering (`tests/task-list-pagination-route.test.ts`).
- Task list now uses hybrid fetch strategy: server-side pagination for non-risk list views, with automatic full-scope fallback for risk-filter/risk-sort paths.
- Task bulk/export/report actions preserve full-filter semantics under server pagination by resolving full matching scope on demand before execution.
- Task list filter state now syncs to URL query keys (`taskQ`, `taskStatus`, `taskPriority`, `taskAssignee`, `taskAssigneeType`, `taskAssignmentMode`, `taskRisk`, `taskSortBy`, `taskSortOrder`, `taskView`) alongside `page/limit` for refresh/share persistence.
- Added workspace E2E coverage to verify task filter query persistence (`taskStatus`, `taskQ`, `taskView`) and filtered result consistency after reload.
- Agents list filter state now syncs to URL query keys (`agentQ`, `agentCapability`, `agentStatus`) alongside `page/limit` for refresh/share persistence.
- Added workspace E2E coverage to verify agent filter query persistence (`agentQ`, `agentCapability`) after reload.
- Added Reports Hub E2E coverage to verify report filter query persistence (`projectId`, `type`, `q`, `limit`, `page`) after reload (`e2e/report-defaults.spec.ts`).
- Added route/unit coverage for bulk-run report save and metadata registry updates (`tests/bulk-run-report-save-route.test.ts`, `tests/reports-metadata.test.ts`).
- Added unit test coverage for shared client fetch retry utility (`tests/fetch-with-timeout-retry.test.ts`).
- Added dedicated starter-pack cache unit tests (`tests/starter-pack-options-cache.test.ts`) for cache hit, force refresh, and concurrent request dedup.
- Core collaboration Playwright regression remains green after starter-pack cache rollout (`e2e/collab-core-flow.spec.ts`, 6/6 passing).
- Task create dialog option loading (`projects/users/agents`) now uses timeout + retry fetch strategy to reduce transient network failure impact before task creation.
- Team creation flow now invalidates team-options cache immediately after successful create (`components/team/create-team-dialog.tsx`), preventing stale team selector options.
- Task list data loaders (tasks/projects/users/current user) now use timeout + retry fetch strategy to reduce transient network failure impact on the Tasks page.
- Tasks list/create now support project-options cache fallback when real-time project fetch fails, preserving operability during transient network/backend issues.
- Docs/README/task-assignment guide terminology was synchronized from `agent role queue` to `agent queue`.
- Agent queue status panel now uses shared timeout+retry fetch utility, longer retry budget, and session snapshot fallback to reduce transient `Failed to fetch queue status` failures.
- Added dedicated Operations workspace page (`/operations`) with scoped project filter, health/status/queue/snapshot panels, and report export/save actions.
- Sidebar now includes an `Operations` navigation entry for centralized runtime observability access.
- Operations health/status E2E suites now validate the dedicated `/operations` entry path and stable refresh interaction.
- Dashboard empty-workspace `Create Team` entry now routes to valid `/teams` page (removed broken `/teams/new` path), with onboarding E2E coverage for the dashboard-to-teams first-step flow.
- Task operations snapshot now uses shared timeout+retry fetch utility and session snapshot fallback so metrics refresh failures keep the last successful view instead of breaking the panel.
- Added operations failure-injection E2E coverage for task metrics refresh fallback (`e2e/operations-status.spec.ts`).
- Dashboard now includes a dedicated `Human-Agent Workflow` guide section (Team -> Project -> Markdown -> Tasks -> Deliverable Review) with live step counters and direct links.
- Dashboard now exposes a `Pending Deliverable Reviews` queue card with direct task-detail links and a review-queue shortcut (`/tasks?status=REVIEW`) for faster final-stage handoff.
- Dashboard workflow guide now includes per-step status labels (`Not Started` / `In Progress` / `Complete`) and overall completion progress for quick mainline bottleneck detection.
- Dashboard workflow guide now also includes step-specific recommended CTA actions (`Create Project`, `Create File`, `Open Review Queue`, etc.) to shorten mainline handoff paths.
- Tasks page now surfaces a review-queue prompt banner when pending `REVIEW` tasks exist outside review view, with one-click switch to `status=REVIEW` to accelerate final-stage deliverable handling.
- Tasks top-level status filter now syncs both `status` and `taskStatus` query keys for consistent report/list behavior, and review queue defaults to `dueDate asc` sorting when no explicit sort is provided.
- Review queue view (`/tasks?status=REVIEW`) now includes a `Review Priority Summary` strip with overdue/due-soon counts and one-click actions (`Sort by Due Date`, `High Risk Only`, `Reset Review Filters`).
- Dashboard and Tasks mainline copy now consistently uses `Review Queue` terminology, and onboarding E2E includes a direct Dashboard review-queue entry assertion.
- Added dedicated review-queue E2E (`e2e/review-queue-priority.spec.ts`) to verify `status`/`taskStatus` normalization, default `dueDate asc` sorting, and review priority summary counts/actions.
- Added runnable script `npm run test:e2e:review` and integrated it into `verify:extended` so review-queue regressions are covered in extended quality gate runs.
- Review queue E2E now also verifies Tasks-page prompt flow (`Open Review Queue`) and confirms normalized URL status params (`status` + `taskStatus`) before loading review-priority view.
- CI extended workflow now runs grouped E2E steps (`workspace`, `team rollout`, `review queue`, `collab core`) so review-mainline regressions are isolated in dedicated job logs.
- Mainline review actions now include explicit accessibility labels and keyboard-focus-visible ring styles (Dashboard workflow links/CTAs, Tasks review prompt button, Review Priority action buttons), with E2E assertions on key `aria-label` names.
- README now includes a dedicated `Mainline Regression Order` section to standardize pre-merge execution sequence (`review -> workspace -> team -> collab -> verify:extended`).
- Release checklist now mirrors the same mainline regression execution order and includes grouped `verify-extended` CI step checks for `workspace/team/review/collab`.
- Added one-command `verify:mainline` script (`review -> workspace -> team -> collab`) and verified it passes locally end-to-end.
- Tasks page URL update logic now preserves existing task query params (e.g. `taskView`) when syncing status/taskStatus, fixing a regression in task-filter persistence flow.
- Release checklist now promotes `verify:mainline` as the default pre-release command at the top of the checklist and clarifies scope of both `verify:mainline` and `verify:core`.
- CI extended workflow comments and step names now explicitly follow `mainline-first` wording (`Mainline · Workspace/Team/Review/Collaboration`) to match local release verification narrative.

- Operations Status Panel now uses session storage caching for stale-data fallback on initial load failure, consistent with Agent Queue Status and Task Operations Snapshot panels.
- Operations Health Banner now uses session storage caching for stale-data fallback on initial load failure, preserving last health snapshot when refresh fails.
- Operations Health Banner refresh button now includes `aria-label="Refresh operations health"` for keyboard/screen-reader accessibility.
- Agent Queue Status table headers now use `scope="col"` attributes; AT RISK badge includes descriptive `aria-label` per domain.
- Task Operations Snapshot dispatch history table headers now use `scope="col"` attributes; Show/Hide toggle buttons include `aria-expanded` and descriptive `aria-label`; retry buttons include retryable count in `aria-label`.
- Agent Queue Console refresh, peek, and claim buttons now include descriptive `aria-label` attributes; domain and agent select dropdowns now include `aria-label` for screen-reader accessibility.
- Added failure-injection E2E for Operations Status Panel (`e2e/operations-status.spec.ts`): validates stale snapshot fallback when `/api/operations/status` returns 500 on refresh.
- Added failure-injection E2E for Operations Health Banner (`e2e/operations-health.spec.ts`): validates stale snapshot fallback when `/api/operations/health` returns 500 on refresh, preserving DEGRADED level and issue list.
- Added degraded-mode E2E coverage (`e2e/operations-status.spec.ts`): validates DEGRADED health banner, degraded queue status notice, and degraded metrics notice rendering on `/operations` page.

- Activity log API now bounds queries to last 90 days by default, avoiding full-table scans at scale; removed redundant `count()` round trip.
- Report history query now bounds FILE_CREATED scans to last 90 days, reducing unbounded scan pressure on high-volume workspaces.
- Task metrics fallback queries now include `take` limits (10000 for backlog, 5000 for risk) to prevent unbounded memory growth.
- Architecture docs updated with Task Orchestration and Operations Hub sections.
- README project structure updated with `/operations` page entry.

- Fixed pre-existing Prisma adapter `@types/pg` version mismatch in `lib/db.ts` and `prisma/seed.ts`; `tsc --noEmit` now reports zero errors.
- Fixed `tests/convert-route.test.ts` missing `lib/db` mock, bringing Jest suite to 104/104 passing (344 tests).
- Full Jest regression is green (104 suites, 344 tests, 0 failures).

## Remaining Work

### Low Priority
1. Further reduce repeated option fetches on dialog-heavy pages.

## Execution Order (Completed)

1. ~~Add failure-injection operations E2E coverage.~~ (Done)
2. ~~Complete UI/accessibility consistency pass on operations/task panels.~~ (Done)
3. ~~Run performance pass on high-traffic data paths.~~ (Done)
4. ~~Complete documentation refresh and release checklist.~~ (Done)
5. ~~Execute full release gate and stabilize failures.~~ (Done — TypeScript 0 errors, Jest 104/104 green)
