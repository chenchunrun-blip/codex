/**
 * MCP Tools for Deliverable Management
 *
 * SECURITY: All handlers verify task ownership before allowing operations
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { submitDeliverable, getDeliverables, getTask } from '../lib/db'

// ============ Schemas ============

export const SubmitDeliverableSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  name: z.string().min(1, 'Deliverable name is required'),
  type: z.string().min(1, 'Deliverable type is required'),
  content: z.string().min(1, 'Content is required'),
  createFile: z.boolean().optional().default(false),
  fileName: z.string().optional(),
  fileType: z.string().optional()
})

export const GetDeliverablesSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required')
})

// ============ Tool Definitions ============

export const submitDeliverableTool: Tool = {
  name: 'submit_deliverable',
  description: 'Submit a deliverable for a task. Optionally create a file for the deliverable content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: 'The ID of the task this deliverable is for'
      },
      name: {
        type: 'string' as const,
        description: 'Name of the deliverable'
      },
      type: {
        type: 'string' as const,
        description: 'Type of deliverable (e.g., markdown, code, report, image)'
      },
      content: {
        type: 'string' as const,
        description: 'The content of the deliverable'
      },
      createFile: {
        type: 'boolean' as const,
        description: 'Whether to create a file for this deliverable',
        default: false
      },
      fileName: {
        type: 'string' as const,
        description: 'Name of the file to create (if createFile is true)'
      },
      fileType: {
        type: 'string' as const,
        description: 'Type of file to create (if createFile is true)'
      }
    },
    required: ['taskId', 'name', 'type', 'content']
  }
}

export const getDeliverablesTool: Tool = {
  name: 'get_deliverables',
  description: 'Get all deliverables for a specific task',
  inputSchema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string' as const,
        description: 'The ID of the task to get deliverables for'
      }
    },
    required: ['taskId']
  }
}

// ============ Tool Handlers ============

export interface ToolHandlerContext {
  agentId: string
  agentName?: string
}

/**
 * Verify that the task belongs to the authenticated agent
 */
async function verifyTaskOwnership(taskId: string, agentId: string): Promise<{
  success: boolean
  error?: string
  task?: Awaited<ReturnType<typeof getTask>>
}> {
  const task = await getTask(taskId)

  if (!task) {
    return { success: false, error: 'Task not found' }
  }

  if (task.agentId !== agentId) {
    return { success: false, error: 'Access denied: This task is not assigned to you' }
  }

  return { success: true, task }
}

export async function handleSubmitDeliverable(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = SubmitDeliverableSchema.safeParse(args)

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

  const { taskId, name, type, content, createFile, fileName, fileType } = parsed.data

  // SECURITY: Verify task ownership before submitting deliverable
  const ownershipCheck = await verifyTaskOwnership(taskId, context.agentId)
  if (!ownershipCheck.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Authorization failed',
          message: ownershipCheck.error
        }, null, 2)
      }]
    }
  }

  try {
    const deliverable = await submitDeliverable({
      taskId,
      name,
      type,
      content,
      createFile,
      fileName,
      fileType
    })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          deliverable: {
            id: deliverable!.id,
            name: deliverable!.name,
            type: deliverable!.type,
            status: deliverable!.status,
            submittedAt: deliverable!.submittedAt,
            fileId: deliverable!.fileId,
            file: deliverable!.file ? {
              id: deliverable!.file!.id,
              name: deliverable!.file!.name,
              fileType: deliverable!.file!.fileType
            } : null
          }
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to submit deliverable',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}

export async function handleGetDeliverables(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = GetDeliverablesSchema.safeParse(args)

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

  // SECURITY: Verify task ownership before returning deliverables
  const ownershipCheck = await verifyTaskOwnership(taskId, context.agentId)
  if (!ownershipCheck.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Authorization failed',
          message: ownershipCheck.error
        }, null, 2)
      }]
    }
  }

  try {
    const deliverables = await getDeliverables(taskId)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId,
          deliverables: deliverables.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            status: d.status,
            submittedAt: d.submittedAt,
            reviewedAt: d.reviewedAt,
            fileId: d.fileId,
            file: d.file ? {
              id: d.file!.id,
              name: d.file!.name,
              fileType: d.file!.fileType
            } : null
          })),
          count: deliverables.length
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to get deliverables',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
