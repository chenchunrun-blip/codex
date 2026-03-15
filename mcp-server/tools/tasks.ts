/**
 * MCP Tools for Task Management
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { listTasks, getTask, updateTaskStatus } from '../lib/db'
import type { TaskStatus } from '@prisma/client'

// ============ Schemas ============

export const ListTasksSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELLED']).optional(),
  projectId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0)
})

export const GetTaskSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required')
})

export const UpdateTaskStatusSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELLED']),
  notes: z.string().optional()
})

// ============ Tool Definitions ============

export const listTasksTool: Tool = {
  name: 'list_tasks',
  description: 'List tasks assigned to the authenticated agent with optional filtering',
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['PENDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELLED'],
        description: 'Filter by task status'
      },
      projectId: {
        type: 'string' as const,
        description: 'Filter by project ID'
      },
      limit: {
        type: 'number' as const,
        description: 'Maximum number of tasks to return (default: 50, max: 100)',
        default: 50
      },
      offset: {
        type: 'number' as const,
        description: 'Number of tasks to skip (for pagination)',
        default: 0
      }
    }
  }
}

export const getTaskTool: Tool = {
  name: 'get_task',
  description: 'Get detailed information about a specific task including its deliverables',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: 'The ID of the task to retrieve'
      }
    },
    required: ['taskId']
  }
}

export const updateTaskStatusTool: Tool = {
  name: 'update_task_status',
  description: 'Update the status of a task. Automatically sets startedAt/completedAt timestamps.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: 'The ID of the task to update'
      },
      status: {
        type: 'string' as const,
        enum: ['PENDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'CANCELLED'],
        description: 'The new status for the task'
      },
      notes: {
        type: 'string' as const,
        description: 'Optional notes about the status change'
      }
    },
    required: ['taskId', 'status']
  }
}

// ============ Tool Handlers ============

export interface ToolHandlerContext {
  agentId: string
}

export async function handleListTasks(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = ListTasksSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { status, projectId, limit, offset } = parsed.data

  try {
    const tasks = await listTasks({
      agentId: context.agentId,
      status: status as TaskStatus,
      projectId,
      limit,
      offset
    })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          tasks: tasks.map(task => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            project: {
              id: task.project.id,
              name: task.project.name
            },
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            deliverableCount: task.deliverables.length
          })),
          count: tasks.length,
          limit,
          offset
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to list tasks',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}

export async function handleGetTask(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = GetTaskSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { taskId } = parsed.data

  try {
    const task = await getTask(taskId)

    if (!task) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Task not found',
            taskId
          }, null, 2)
        }]
      }
    }

    // Verify the task is assigned to this agent
    if (task.agentId !== context.agentId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Access denied',
            message: 'This task is not assigned to you'
          }, null, 2)
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          project: {
            id: task.project.id,
            name: task.project.name,
            description: task.project.description
          },
          agent: task.agent ? {
            id: task.agent.id,
            name: task.agent.name,
            displayName: task.agent.displayName
          } : null,
          dueDate: task.dueDate,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          deliverables: task.deliverables.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            status: d.status,
            submittedAt: d.submittedAt
          }))
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to get task',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}

export async function handleUpdateTaskStatus(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = UpdateTaskStatusSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { taskId, status, notes } = parsed.data

  try {
    // First verify the task is assigned to this agent
    const existingTask = await getTask(taskId)

    if (!existingTask) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Task not found',
            taskId
          }, null, 2)
        }]
      }
    }

    if (existingTask.agentId !== context.agentId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Access denied',
            message: 'This task is not assigned to you'
          }, null, 2)
        }]
      }
    }

    const updatedTask = await updateTaskStatus(taskId, status as TaskStatus, notes)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          task: {
            id: updatedTask!.id,
            title: updatedTask!.title,
            status: updatedTask!.status,
            startedAt: updatedTask!.startedAt,
            completedAt: updatedTask!.completedAt,
            updatedAt: updatedTask!.updatedAt
          },
          notes
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to update task status',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
