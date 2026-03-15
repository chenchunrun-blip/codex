/**
 * Database operations for MCP Server
 * Provides typed database access for tasks, agents, and deliverables
 */

import { db } from '../../lib/db'
import type {
  Task,
  Agent,
  Deliverable,
  TaskStatus,
  Project,
  File
} from '@prisma/client'

// ============ Types ============

export type TaskWithRelations = Task & {
  project: Pick<Project, 'id' | 'name' | 'description'>
  agent?: Pick<Agent, 'id' | 'name' | 'displayName'> | null
  deliverables: Deliverable[]
}

export type DeliverableWithRelations = Deliverable & {
  file?: Pick<File, 'id' | 'name' | 'fileType'> | null
}

export type AgentInfo = Agent & {
  _count: {
    tasks: number
  }
}

// ============ Task Operations ============

export interface ListTasksOptions {
  agentId?: string
  status?: TaskStatus
  projectId?: string
  limit?: number
  offset?: number
}

/**
 * Get tasks with optional filters
 */
export async function listTasks(options: ListTasksOptions = {}): Promise<TaskWithRelations[]> {
  const {
    agentId,
    status,
    projectId,
    limit = 50,
    offset = 0
  } = options

  const where: Record<string, unknown> = {}

  if (agentId) {
    where.agentId = agentId
  }

  if (status) {
    where.status = status
  }

  if (projectId) {
    where.projectId = projectId
  }

  return db.task.findMany({
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
          description: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true,
          displayName: true
        }
      },
      deliverables: true
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: limit,
    skip: offset
  }) as Promise<TaskWithRelations[]>
}

/**
 * Get a single task by ID
 */
export async function getTask(taskId: string): Promise<TaskWithRelations | null> {
  return db.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          description: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true,
          displayName: true
        }
      },
      deliverables: {
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  }) as Promise<TaskWithRelations | null>
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  notes?: string
): Promise<TaskWithRelations | null> {
  const updateData: {
    status: TaskStatus
    completedAt?: Date
    startedAt?: Date
  } = { status }

  // Set timestamps based on status
  if (status === 'IN_PROGRESS' && !updateData.startedAt) {
    updateData.startedAt = new Date()
  }

  if (status === 'COMPLETED') {
    updateData.completedAt = new Date()
  }

  return db.task.update({
    where: { id: taskId },
    data: updateData,
    include: {
      project: {
        select: {
          id: true,
          name: true,
          description: true
        }
      },
      agent: {
        select: {
          id: true,
          name: true,
          displayName: true
        }
      },
      deliverables: true
    }
  }) as Promise<TaskWithRelations | null>
}

/**
 * Create an activity log entry for a task
 */
export async function logTaskActivity(
  taskId: string,
  userId: string,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const task = await db.task.findUnique({
    select: { projectId: true },
    where: { id: taskId }
  })

  if (!task) {
    throw new Error('Task not found')
  }

  await db.activityLog.create({
    data: {
      projectId: task.projectId,
      taskId,
      userId,
      action: action as any,
      metadata: metadata as any
    }
  })
}

// ============ Deliverable Operations ============

export interface CreateDeliverableInput {
  taskId: string
  name: string
  type: string
  content: string
  createFile?: boolean
  fileName?: string
  fileType?: string
  creatorId?: string // Required if createFile is true
}

/**
 * Submit a deliverable for a task
 */
export async function submitDeliverable(
  input: CreateDeliverableInput
): Promise<DeliverableWithRelations | null> {
  const { taskId, name, type, content, createFile, fileName, fileType, creatorId } = input

  // Verify task exists
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true }
  })

  if (!task) {
    throw new Error('Task not found')
  }

  let fileId: string | undefined

  // Optionally create a file for the deliverable
  if (createFile) {
    // Get project creator as file creator
    const project = await db.project.findUnique({
      where: { id: task.projectId },
      select: { creatorId: true }
    })

    const fileCreatorId = creatorId || project?.creatorId

    if (!fileCreatorId) {
      throw new Error('Cannot create file: no creatorId provided and project has no creator')
    }

    const file = await db.file.create({
      data: {
        name: fileName || `${name}.md`,
        content,
        fileType: (fileType as any) || 'CUSTOM',
        status: 'DRAFT',
        projectId: task.projectId,
        creatorId: fileCreatorId,
        storageId: `deliverable-${Date.now()}`
      }
    })
    fileId = file.id
  }

  return db.deliverable.create({
    data: {
      taskId,
      fileId,
      name,
      type,
      content,
      status: 'SUBMITTED',
      submittedAt: new Date()
    },
    include: {
      file: {
        select: {
          id: true,
          name: true,
          fileType: true
        }
      }
    }
  }) as Promise<DeliverableWithRelations | null>
}

/**
 * Get deliverables for a task
 */
export async function getDeliverables(taskId: string): Promise<DeliverableWithRelations[]> {
  return db.deliverable.findMany({
    where: { taskId },
    include: {
      file: {
        select: {
          id: true,
          name: true,
          fileType: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  }) as Promise<DeliverableWithRelations[]>
}

// ============ Agent Operations ============

/**
 * Get agent information
 */
export async function getAgentInfo(agentId: string): Promise<AgentInfo | null> {
  return db.agent.findUnique({
    where: { id: agentId },
    include: {
      _count: {
        select: {
          tasks: true
        }
      }
    }
  }) as Promise<AgentInfo | null>
}

/**
 * Get agent by name
 */
export async function getAgentByName(name: string): Promise<AgentInfo | null> {
  return db.agent.findUnique({
    where: { name },
    include: {
      _count: {
        select: {
          tasks: true
        }
      }
    }
  }) as Promise<AgentInfo | null>
}

// ============ Project Operations ============

/**
 * Get project information
 */
export async function getProjectInfo(projectId: string): Promise<Project | null> {
  return db.project.findUnique({
    where: { id: projectId }
  })
}

// ============ File Operations ============

/**
 * Get file content
 */
export async function getFileContent(fileId: string): Promise<{ file: File; content: string } | null> {
  const file = await db.file.findUnique({
    where: { id: fileId }
  })

  if (!file) {
    return null
  }

  return {
    file,
    content: file.content
  }
}
