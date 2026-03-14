import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AssigneeType, TaskStatus } from '@prisma/client'

jest.mock('@/lib/auth/rbac', () => ({
  requireAuth: jest.fn(async () => ({
    user: { id: 'user_actor', email: 'actor@example.com' }
  }))
}))

jest.mock('@/lib/db', () => ({
  db: {
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    task: {
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn()
    },
    deliverable: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn()
    },
    agent: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    taskAssignmentLog: {
      create: jest.fn()
    },
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    notification: {
      create: jest.fn()
    }
  }
}))

const { db } = require('@/lib/db')
const dbMock = db as Record<string, any>
// Import route handlers after mocks are registered.
const { POST: claimPost } = require('@/app/api/tasks/[id]/claim/route')
const { POST: suggestPost } = require('@/app/api/tasks/[id]/suggest-assignee/route')
const { POST: assignPost } = require('@/app/api/tasks/[id]/assign/route')
const { POST: unassignPost } = require('@/app/api/tasks/[id]/unassign/route')
const { POST: runAgentPost } = require('@/app/api/tasks/[id]/run-agent/route')

describe('Task Assignment Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 400 for invalid JSON payload on assign", async () => {
    const req = new Request("http://localhost/api/tasks/task_a/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid"
    })

    const res = await assignPost(req, { params: Promise.resolve({ id: "task_a" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_JSON")
  })

  it("returns 400 for invalid request payload on suggest-assignee", async () => {
    const req = new Request("http://localhost/api/tasks/task_b/suggest-assignee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 0 })
    })

    const res = await suggestPost(req, { params: Promise.resolve({ id: "task_b" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })

  it("returns 400 for invalid request payload on run-agent", async () => {
    const req = new Request("http://localhost/api/tasks/task_c/run-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "short" })
    })

    const res = await runAgentPost(req, { params: Promise.resolve({ id: "task_c" }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe("INVALID_REQUEST_PAYLOAD")
  })

  it('claims task by human and moves status to IN_PROGRESS', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_1',
      title: 'Task 1',
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null,
      startedAt: null,
      claimedAt: null
    })
    dbMock.projectMember.findUnique
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })
      .mockResolvedValueOnce({ projectId: 'proj_1', userId: 'user_actor', role: 'EDITOR' })
    dbMock.task.update.mockResolvedValue({
      id: 'task_1',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: 'user_actor',
      agentId: null,
      functionalAgentType: null,
      claimedAt: new Date('2026-03-11T13:30:00.000Z'),
      status: TaskStatus.IN_PROGRESS
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_1/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigneeType: 'HUMAN',
        assigneeId: 'user_actor'
      })
    })

    const res = await claimPost(req, { params: Promise.resolve({ id: 'task_1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe(TaskStatus.IN_PROGRESS)
    expect(data.assigneeType).toBe(AssigneeType.HUMAN)
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('returns 400 when claim payload is empty', async () => {
    const req = new Request('http://localhost/api/tasks/task_1/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await claimPost(req, { params: Promise.resolve({ id: 'task_1' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_CLAIM_PAYLOAD')
    expect(dbMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 when claim payload is invalid json', async () => {
    const req = new Request('http://localhost/api/tasks/task_1/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json}'
    })

    const res = await claimPost(req, { params: Promise.resolve({ id: 'task_1' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('INVALID_CLAIM_PAYLOAD')
    expect(dbMock.task.findUnique).not.toHaveBeenCalled()
  })

  it('returns top-N suggestions and logs suggestion action', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_2',
      title: 'Build API',
      description: 'Engineering work',
      specMarkdown: '## Goal\n- Build API',
      projectId: 'proj_1',
      functionalAgentType: null,
      dueDate: new Date('2026-03-20T00:00:00.000Z')
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.projectMember.findMany.mockResolvedValue([
      { userId: 'user_1', user: { id: 'user_1', name: 'A', nickname: 'a' } },
      { userId: 'user_2', user: { id: 'user_2', name: 'B', nickname: 'b' } }
    ])
    dbMock.task.groupBy
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 1 }])
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 2 }])
      .mockResolvedValueOnce([{ agentId: 'agent_1', _count: 0 }])
    dbMock.agent.findMany.mockResolvedValue([
      { id: 'agent_1', name: 'eng-agent', displayName: 'Eng Agent', capabilities: ['engineering'] }
    ])
    dbMock.taskAssignmentLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_2/suggest-assignee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topN: 2 })
    })

    const res = await suggestPost(req, { params: Promise.resolve({ id: 'task_2' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.suggestions)).toBe(true)
    expect(data.suggestions.length).toBe(2)
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('accepts agentDomainMatch weight (compat with legacy functionalMatch)', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_2b',
      title: 'Design UI',
      description: 'Design work',
      specMarkdown: '## Goal\n- Design new UI',
      projectId: 'proj_1',
      functionalAgentType: null,
      dueDate: new Date('2026-03-20T00:00:00.000Z')
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.projectMember.findMany.mockResolvedValue([
      { userId: 'user_1', user: { id: 'user_1', name: 'A', nickname: 'a' } }
    ])
    dbMock.task.groupBy
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 1 }])
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 1 }])
      .mockResolvedValueOnce([{ agentId: 'agent_1', _count: 0 }])
    dbMock.agent.findMany.mockResolvedValue([
      { id: 'agent_1', name: 'design-agent', displayName: 'Design Agent', capabilities: ['design'] }
    ])
    dbMock.taskAssignmentLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_2b/suggest-assignee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topN: 1,
        weights: { agentDomainMatch: 0.7, workload: 0.2, deadlineRisk: 0.1 }
      })
    })

    const res = await suggestPost(req, { params: Promise.resolve({ id: 'task_2b' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.suggestions)).toBe(true)
    expect(data.suggestions.length).toBe(1)
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('filters out offline agents when project dispatch policy is online-only', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_2c',
      title: 'Implement worker',
      description: 'Engineering queue',
      specMarkdown: '## Goal\n- Implement worker',
      projectId: 'proj_1',
      functionalAgentType: null,
      dueDate: new Date('2026-03-20T00:00:00.000Z')
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.projectMember.findMany.mockResolvedValue([
      { userId: 'user_1', user: { id: 'user_1', name: 'A', nickname: 'a' } }
    ])
    dbMock.task.groupBy
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 0 }])
      .mockResolvedValueOnce([{ assigneeId: 'user_1', _count: 0 }])
      .mockResolvedValueOnce([{ agentId: 'agent_online', _count: 0 }])
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
        metadata: {
          type: 'PROJECT_DISPATCH_POLICY_UPDATED',
          onlineOnly: true
        }
      }
    ])
    dbMock.agent.findMany.mockResolvedValue([
      {
        id: 'agent_online',
        name: 'eng-online',
        displayName: 'Eng Online',
        capabilities: ['engineering'],
        updatedAt: new Date()
      },
      {
        id: 'agent_offline',
        name: 'eng-offline',
        displayName: 'Eng Offline',
        capabilities: ['engineering'],
        updatedAt: new Date(Date.now() - 10 * 60 * 1000)
      }
    ])
    dbMock.taskAssignmentLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_2c/suggest-assignee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topN: 5 })
    })

    const res = await suggestPost(req, { params: Promise.resolve({ id: 'task_2c' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.dispatchPolicy?.onlineOnly).toBe(true)
    const suggestedAgentIds = (data.suggestions || [])
      .map((item: any) => item.agentId)
      .filter(Boolean)
    expect(suggestedAgentIds).toContain('agent_online')
    expect(suggestedAgentIds).not.toContain('agent_offline')
    const onlineSuggestion = (data.suggestions || []).find((item: any) => item.agentId === 'agent_online')
    expect(onlineSuggestion?.agentOnline).toBe(true)
  })

  it('confirms assignment for functional agent with AI_SUGGESTED mode', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_3',
      title: 'Task 3',
      projectId: 'proj_1',
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
      id: 'task_3',
      assigneeType: AssigneeType.FUNCTIONAL_AGENT,
      assigneeId: null,
      agentId: null,
      functionalAgentType: 'ENGINEERING',
      assignmentMode: 'AI_SUGGESTED',
      projectId: 'proj_1'
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_3/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigneeType: 'FUNCTIONAL_AGENT',
        functionalAgentType: 'ENGINEERING',
        assignmentMode: 'AI_SUGGESTED',
        source: 'suggestion'
      })
    })

    const res = await assignPost(req, { params: Promise.resolve({ id: 'task_3' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.assigneeType).toBe(AssigneeType.FUNCTIONAL_AGENT)
    expect(data.assignmentMode).toBe('AI_SUGGESTED')
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('rejects AGENT assignment when online-only policy is enabled and agent is offline', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_3b',
      title: 'Task 3b',
      projectId: 'proj_1',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
        metadata: {
          type: 'PROJECT_DISPATCH_POLICY_UPDATED',
          onlineOnly: true
        }
      }
    ])
    dbMock.agent.findUnique.mockResolvedValue({
      id: 'agent_offline',
      isActive: true,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000)
    })

    const req = new Request('http://localhost/api/tasks/task_3b/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigneeType: 'AGENT',
        agentId: 'agent_offline',
        assignmentMode: 'AI_SUGGESTED',
        source: 'suggestion'
      })
    })

    const res = await assignPost(req, { params: Promise.resolve({ id: 'task_3b' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('AGENT_OFFLINE_BY_POLICY')
    expect(dbMock.task.update).not.toHaveBeenCalled()
  })

  it('unassigns task and clears assignee fields', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_4',
      title: 'Task 4',
      projectId: 'proj_1',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: 'user_1',
      agentId: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.task.update.mockResolvedValue({
      id: 'task_4',
      assigneeType: AssigneeType.HUMAN,
      assigneeId: null,
      agentId: null,
      functionalAgentType: null,
      claimedAt: null
    })
    dbMock.taskAssignmentLog.create.mockResolvedValue({})
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_4/unassign', {
      method: 'POST'
    })

    const res = await unassignPost(req, { params: Promise.resolve({ id: 'task_4' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.assigneeId).toBeNull()
    expect(data.agentId).toBeNull()
    expect(dbMock.taskAssignmentLog.create).toHaveBeenCalled()
  })

  it('runs agent task and creates submitted deliverable', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_5',
      title: 'Task 5',
      description: 'Execute agent pipeline',
      specMarkdown: '# TaskSpec\n\n## Goal\n- deliver output',
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      startedAt: null,
      assigneeType: AssigneeType.FUNCTIONAL_AGENT,
      assigneeId: null,
      agentId: null,
      functionalAgentType: 'ENGINEERING'
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.deliverable.create.mockResolvedValue({
      id: 'del_1',
      name: 'Task 5 - Agent Run',
      status: 'SUBMITTED',
      createdAt: new Date('2026-03-12T00:00:00.000Z')
    })
    dbMock.deliverable.update.mockResolvedValue({})
    dbMock.activityLog.findMany.mockResolvedValue([])
    dbMock.task.update.mockResolvedValue({
      id: 'task_5',
      status: TaskStatus.IN_PROGRESS
    })
    dbMock.activityLog.create.mockResolvedValue({})

    const req = new Request('http://localhost/api/tasks/task_5/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionNotes: 'Run engineering queue task',
        autoSubmit: true
      })
    })

    const res = await runAgentPost(req, { params: Promise.resolve({ id: 'task_5' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.taskId).toBe('task_5')
    expect(data.status).toBe(TaskStatus.IN_PROGRESS)
    expect(dbMock.deliverable.create).toHaveBeenCalled()
    expect(dbMock.activityLog.create).toHaveBeenCalled()
  })

  it('rejects run-agent for human task', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_6',
      title: 'Task 6',
      description: null,
      specMarkdown: null,
      projectId: 'proj_1',
      status: TaskStatus.PENDING,
      startedAt: null,
      assigneeType: AssigneeType.HUMAN,
      assigneeId: 'user_1',
      agentId: null,
      functionalAgentType: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.activityLog.findMany.mockResolvedValue([])

    const req = new Request('http://localhost/api/tasks/task_6/run-agent', {
      method: 'POST'
    })

    const res = await runAgentPost(req, { params: Promise.resolve({ id: 'task_6' }) })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.code).toBe('TASK_NOT_AGENT_EXECUTABLE')
    expect(dbMock.deliverable.create).not.toHaveBeenCalled()
  })

  it('deduplicates run-agent when idempotencyKey already exists', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_7',
      title: 'Task 7',
      description: null,
      specMarkdown: '# TaskSpec',
      projectId: 'proj_1',
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date('2026-03-12T00:00:00.000Z'),
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: 'agent_1',
      functionalAgentType: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        metadata: {
          type: 'AGENT_RUN_TRIGGERED',
          idempotencyKey: 'idem_key_123',
          deliverableId: 'del_7'
        },
        createdAt: new Date('2026-03-12T08:00:00.000Z')
      }
    ])
    dbMock.deliverable.findUnique.mockResolvedValue({
      id: 'del_7',
      name: 'Task 7 - Agent Run',
      status: 'SUBMITTED',
      createdAt: new Date('2026-03-12T08:00:00.000Z')
    })

    const req = new Request('http://localhost/api/tasks/task_7/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'idem_key_123' })
    })

    const res = await runAgentPost(req, { params: Promise.resolve({ id: 'task_7' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.deduplicated).toBe(true)
    expect(dbMock.deliverable.create).not.toHaveBeenCalled()
  })

  it('returns conflict when run-agent is triggered too frequently', async () => {
    dbMock.task.findUnique.mockResolvedValue({
      id: 'task_8',
      title: 'Task 8',
      description: null,
      specMarkdown: '# TaskSpec',
      projectId: 'proj_1',
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date('2026-03-12T00:00:00.000Z'),
      assigneeType: AssigneeType.AGENT,
      assigneeId: null,
      agentId: 'agent_1',
      functionalAgentType: null
    })
    dbMock.projectMember.findUnique.mockResolvedValue({
      projectId: 'proj_1',
      userId: 'user_actor',
      role: 'EDITOR'
    })
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        metadata: { type: 'AGENT_RUN_TRIGGERED' },
        createdAt: new Date()
      }
    ])

    const req = new Request('http://localhost/api/tasks/task_8/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    const res = await runAgentPost(req, { params: Promise.resolve({ id: 'task_8' }) })
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('AGENT_RUN_CONFLICT')
  })
})
