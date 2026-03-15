# Sprint 1 API Contract (S1-05 ~ S1-11)

This document defines the API and data contract for:
- `TaskSpec.md` validation
- dual-claim mode (`HUMAN` / `FUNCTIONAL_AGENT`, product term: Agent Queue)
- assignee suggestion
- assignment audit trail

## 1) Data Model Changes (Prisma)

### 1.1 Task (extend existing model)

Add fields to `Task`:

```prisma
model Task {
  // existing fields...
  specMarkdown          String?   @db.Text
  specValidationStatus  SpecValidationStatus @default(PENDING)
  specValidationErrors  Json?

  assignmentMode        AssignmentMode @default(MANUAL)
  assigneeType          AssigneeType   @default(HUMAN) // existing enum should be extended
  assigneeId            String?
  agentId               String?
  functionalAgentType   FunctionalAgentType?
  claimedAt             DateTime?
}
```

### 1.2 New Log Table

```prisma
model TaskAssignmentLog {
  id             String   @id @default(cuid())
  taskId         String
  action         TaskAssignmentAction
  actorUserId    String
  fromType       AssigneeType?
  fromAssigneeId String?
  fromAgentId    String?
  toType         AssigneeType?
  toAssigneeId   String?
  toAgentId      String?
  reason         String?
  metadata       Json?
  createdAt      DateTime @default(now())

  task           Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor          User     @relation(fields: [actorUserId], references: [id], onDelete: Cascade)

  @@index([taskId, createdAt])
  @@index([actorUserId])
}
```

### 1.3 Enums

```prisma
enum SpecValidationStatus {
  PENDING
  VALID
  INVALID
}

enum AssignmentMode {
  MANUAL
  AI_SUGGESTED
  AI_AUTO
}

enum AssigneeType {
  HUMAN
  AGENT
  FUNCTIONAL_AGENT
}

enum FunctionalAgentType {
  PRODUCT
  ENGINEERING
  QA
  DESIGN
  OPERATIONS
}

enum TaskAssignmentAction {
  SUGGESTED
  ASSIGNED
  CLAIMED
  UNCLAIMED
  REASSIGNED
}
```

### 1.4 Terminology Compatibility

- Product/UI terminology uses **Agent Queue** and **Agent Domain**.
- For backward compatibility, API/database field names remain `functionalAgentType`.
- For backward compatibility, enum value remains `FUNCTIONAL_AGENT`.

## 2) TaskSpec Contract

### 2.1 Minimal Markdown Structure

```md
# TaskSpec

## Goal
- ...

## Deliverables
- ...

## Requirements
- ...

## Acceptance Criteria
- ...

## Priority
- HIGH | MEDIUM | LOW

## Due Date
- YYYY-MM-DD
```

### 2.2 Validation Rules

- `Goal`, `Deliverables`, `Requirements`, `Acceptance Criteria` must exist and be non-empty.
- `Priority` must be one of: `HIGH`, `MEDIUM`, `LOW`.
- `Due Date` must be a valid ISO date if provided.

## 3) APIs

All APIs reuse current auth style (`requireAuthApi` / `requireAuth`) and return JSON.

### 3.1 Create Task

`POST /api/tasks`

Request:

```json
{
  "projectId": "proj_xxx",
  "title": "Implement login audit",
  "description": "Optional short summary",
  "priority": 2,
  "specMarkdown": "# TaskSpec\n\n## Goal\n- ...",
  "assignmentMode": "AI_SUGGESTED"
}
```

Success `201`:

```json
{
  "id": "task_xxx",
  "projectId": "proj_xxx",
  "title": "Implement login audit",
  "specValidationStatus": "VALID",
  "specValidationErrors": null,
  "status": "PENDING"
}
```

Error:
- `400` `INVALID_TASK_SPEC`
- `403` `INSUFFICIENT_PERMISSIONS`
- `404` `PROJECT_NOT_FOUND`

### 3.2 Claim Task (human or agent queue)

`POST /api/tasks/{id}/claim`

Request (`HUMAN`):

```json
{
  "assigneeType": "HUMAN",
  "assigneeId": "user_xxx",
  "reason": "Manual claim by engineer on duty"
}
```

Request (`FUNCTIONAL_AGENT`):

```json
{
  "assigneeType": "FUNCTIONAL_AGENT",
  "functionalAgentType": "ENGINEERING",
  "agentId": "agent_xxx",
  "reason": "Claimed by engineering agent queue"
}
```

Success `200`:

```json
{
  "taskId": "task_xxx",
  "assigneeType": "HUMAN",
  "assigneeId": "user_xxx",
  "claimedAt": "2026-03-11T10:00:00.000Z",
  "status": "IN_PROGRESS"
}
```

Error:
- `400` `INVALID_CLAIM_PAYLOAD`
- `403` `NOT_PROJECT_MEMBER`
- `409` `TASK_ALREADY_CLAIMED`

### 3.3 Suggest Assignee

`POST /api/tasks/{id}/suggest-assignee`

Request:

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

Success `200`:

```json
{
  "taskId": "task_xxx",
  "suggestions": [
    {
      "rank": 1,
      "assigneeType": "HUMAN",
      "assigneeId": "user_1",
      "score": 0.91,
      "reasons": [
        "Functional match: ENGINEERING",
        "Low current workload"
      ]
    },
    {
      "rank": 2,
      "assigneeType": "FUNCTIONAL_AGENT",
      "functionalAgentType": "ENGINEERING",
      "agentId": "agent_1",
      "score": 0.83,
      "reasons": [
        "High capability match"
      ]
    }
  ]
}
```

Error:
- `403` `NOT_PROJECT_MEMBER`
- `404` `TASK_NOT_FOUND`

### 3.4 Confirm Assignment

`POST /api/tasks/{id}/assign`

Request:

```json
{
  "assigneeType": "FUNCTIONAL_AGENT",
  "functionalAgentType": "ENGINEERING",
  "agentId": "agent_xxx",
  "assignmentMode": "AI_SUGGESTED",
  "source": "suggestion",
  "reason": "Accepted recommendation rank #1"
}
```

Success `200`:

```json
{
  "taskId": "task_xxx",
  "assigneeType": "FUNCTIONAL_AGENT",
  "functionalAgentType": "ENGINEERING",
  "agentId": "agent_xxx",
  "assignmentMode": "AI_SUGGESTED",
  "updatedAt": "2026-03-11T10:05:00.000Z"
}
```

Error:
- `400` `INVALID_ASSIGNMENT_PAYLOAD`
- `403` `INSUFFICIENT_PERMISSIONS`
- `404` `TASK_NOT_FOUND`

### 3.5 Agent Queue Pull (Autonomous Claim)

`POST /api/tasks/agent-queue/pull`

Headers:

- `x-agent-id: <agent_id>`
- `Authorization: Bearer <agent_key>` (or `x-agent-key`)

Request:

```json
{
  "projectId": "proj_xxx",
  "functionalAgentType": "ENGINEERING",
  "claim": true
}
```

Rules:

- `claim=true` (default): claim next queue task using optimistic concurrency.
- `claim=false`: return next candidate task without state mutation.
- Only tasks with `assigneeType=FUNCTIONAL_AGENT` + matching `functionalAgentType` are eligible.

Success `200`:

```json
{
  "task": {
    "id": "task_xxx",
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

Error:
- `401` `AGENT_AUTH_REQUIRED`
- `401` `AGENT_AUTH_INVALID`
- `403` `AGENT_INACTIVE`
- `409` `AGENT_QUEUE_CLAIM_CONFLICT`

## 4) Error Response Standard

```json
{
  "error": {
    "code": "INVALID_TASK_SPEC",
    "message": "TaskSpec missing required section: Acceptance Criteria",
    "details": {
      "missingSections": ["Acceptance Criteria"]
    }
  }
}
```

## 5) State Transition Rules

- `PENDING -> IN_PROGRESS`: on successful claim.
- `IN_PROGRESS -> REVIEW`: when deliverable submitted.
- `REVIEW -> COMPLETED`: approved.
- `REVIEW -> IN_PROGRESS`: rejected and returned.
- Task cannot be claimed if already `COMPLETED` or `CANCELLED`.

## 6) Security and Permission Rules

- Create/Assign/Reassign: `EDITOR` or `ADMIN`.
- Claim by human: project member.
- Claim by functional agent: caller must be `EDITOR` or `ADMIN`.
- Every suggest/assign/claim must write `TaskAssignmentLog`.

## 7) Implementation Sequence (S1)

1. Prisma migration for new fields and `TaskAssignmentLog`.
2. Add Zod schemas for `TaskSpec`, `claim`, `suggest`, `assign`.
3. Implement API routes in this order:
   - `/api/tasks` (spec validation first)
   - `/api/tasks/{id}/claim`
   - `/api/tasks/{id}/suggest-assignee`
   - `/api/tasks/{id}/assign`
4. Add unit tests for validator and suggestion scoring.
5. Add integration test for full flow: create -> suggest -> assign -> claim -> submit.
