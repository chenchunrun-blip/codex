import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AssigneeType, SpecValidationStatus, TaskStatus } from '@prisma/client'

jest.mock('@/lib/auth/rbac', () => ({
  requireAuthApi: jest.fn(async () => ({
    user: { id: 'user_actor', email: 'actor@example.com' }
  })),
  requireAuth: jest.fn(async () => ({
    user: { id: 'user_actor', email: 'actor@example.com' }
  }))
}))

jest.mock('@/lib/db', () => ({
  db: {
    projectMember: {
      findUnique: jest.fn()
    },
    task: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    agent: {
      findUnique: jest.fn()
    },
    activityLog: {
      create: jest.fn()
    },
    notification: {
      create: jest.fn()
    },
    taskAssignmentLog: {
      create: jest.fn()
    }
  }
}))

const { db } = require('@/lib/db')
const dbMock = db as Record<string, any>
const { POST: createTaskPost } = require('@/app/api/tasks/route')
const { GET: getTask } = require('@/app/api/tasks/[id]/route')
const { PATCH: patchTask } = require('@/app/api/tasks/[id]/route')

describe('Task Routes Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 for invalid create payload', async () => {
    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_REQUEST_PAYLOAD')
  })

  it('returns 400 when FUNCTIONAL_AGENT lacks functionalAgentType', async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })

    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Task with functional agent',
        projectId: 'proj_1',
        assigneeType: 'FUNCTIONAL_AGENT'
      })
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_ASSIGNMENT_PAYLOAD')
  })

  it('rejects task creation when spec markdown is invalid', async () => {
    dbMock.projectMember.findUnique
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })

    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Task 1',
        projectId: 'proj_1',
        assigneeType: 'HUMAN',
        assigneeId: 'user_actor',
        specMarkdown: '# TaskSpec\n\n## Goal\n- only partial'
      })
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_REQUEST_PAYLOAD')
  })

  it('creates task with valid spec markdown', async () => {
    dbMock.projectMember.findUnique
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })
    dbMock.task.create.mockResolvedValue({
      id: 'task_1',
      title: 'Task 1',
      projectId: 'proj_1',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: 'user_actor',
      agentId: null,
      assignmentMode: 'MANUAL',
      specValidationStatus: SpecValidationStatus.VALID,
      functionalAgentType: null
    })
    dbMock.activityLog.create.mockResolvedValue({})
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.notification.create.mockResolvedValue({})

    const validSpec = `# TaskSpec

## Goal
- Build API

## Deliverables
- Endpoint docs

## Requirements
- Must validate payload

## Acceptance Criteria
- Tests pass

## Priority
- HIGH`

    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Task 1',
        projectId: 'proj_1',
        assigneeType: 'HUMAN',
        assigneeId: 'user_actor',
        specMarkdown: validSpec
      })
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.specValidationStatus).toBe(SpecValidationStatus.VALID)
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('creates unassigned HUMAN task when assigneeId is omitted', async () => {
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.task.create.mockResolvedValue({
      id: 'task_ua_1',
      title: 'Unassigned task',
      projectId: 'proj_1',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null,
      assignmentMode: 'MANUAL',
      specValidationStatus: SpecValidationStatus.PENDING,
      functionalAgentType: null
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Unassigned task',
        projectId: 'proj_1',
        assigneeType: 'HUMAN'
      })
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.assigneeType).toBe(AssigneeType.HUMAN)
    expect(data.assigneeId).toBeNull()
  })

  it("returns NOT_PROJECT_MEMBER when creating task without membership", async () => {
    dbMock.projectMember.findUnique.mockReset()
    dbMock.projectMember.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Task no membership",
        projectId: "proj_1",
        assigneeType: "HUMAN"
      })
    })

    const res = await createTaskPost(req)
    const data = await res.json()

    expect(dbMock.projectMember.findUnique).toHaveBeenCalled()
    expect(res.status).toBe(403)
    expect(data.code).toBe("NOT_PROJECT_MEMBER")
  })

  it('PATCH logs reassignment when assignment fields change', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_2',
      title: 'Task 2',
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      startedAt: null,
      completedAt: null,
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.task.update.mockResolvedValue({
      id: 'task_2',
      title: 'Task 2',
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: 'agent_1',
      assignmentMode: 'AI_SUGGESTED',
      functionalAgentType: null
    })
    dbMock.activityLog.create.mockResolvedValue({})
    dbMock.taskAssignmentLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigneeType: 'AGENT',
        agentId: 'agent_1',
        assignmentMode: 'AI_SUGGESTED'
      })
    })

    const res = await patchTask(req, { params: Promise.resolve({ id: 'task_2' }) })
    expect(res.status).toBe(200)
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('PATCH rejects invalid TaskSpec markdown payload', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_3',
      title: 'Task 3',
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      startedAt: null,
      completedAt: null,
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })

    const req = new Request('http://localhost/api/tasks/task_3', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        specMarkdown: '# TaskSpec\n\n## Goal\n- only one section'
      })
    })

    const res = await patchTask(req, { params: Promise.resolve({ id: 'task_3' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_REQUEST_PAYLOAD')
  })

  it('GET includes assignment logs for timeline rendering', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_5',
      title: 'Task 5',
      projectId: 'proj_1',
      assignmentLogs: [
        {
          id: 'assign_log_1',
          action: 'ASSIGNED',
          reason: 'Manual assign',
          createdAt: new Date('2026-03-11T12:00:00.000Z'),
          fromType: 'HUMAN',
          fromAssigneeId: null,
          fromAgentId: null,
          toType: 'AGENT',
          toAssigneeId: null,
          toAgentId: 'agent_1',
          actor: {
            id: 'user_actor',
            name: 'Actor',
            email: 'actor@example.com'
          }
        }
      ]
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })

    const req = new Request('http://localhost/api/tasks/task_5', { method: 'GET' })
    const res = await getTask(req, { params: Promise.resolve({ id: 'task_5' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.assignmentLogs)).toBe(true)
    expect(data.assignmentLogs).toHaveLength(1)
    expect(data.assignmentLogs[0].action).toBe('ASSIGNED')
  })

  it("GET returns TASK_NOT_FOUND code for missing task", async () => {
    dbMock.task.findUnique.mockResolvedValue(null)

    const req = new Request("http://localhost/api/tasks/task_missing", { method: "GET" })
    const res = await getTask(req, { params: Promise.resolve({ id: "task_missing" }) })
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe("TASK_NOT_FOUND")
  })
})
