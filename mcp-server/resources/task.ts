/**
 * MCP Resources for Task Context
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { getTask, listTasks } from '../lib/db'

// ============ Resource Definitions ============

export const taskContextResource: Resource = {
  uri: 'task://{taskId}/context',
  name: 'Task Context',
  description: 'Get full context for a task including related project, deliverables, and history',
  mimeType: 'application/json'
}

// ============ Resource Handlers ============

export interface ResourceHandlerContext {
  agentId: string
}

export async function handleTaskResource(
  uri: string,
  context: ResourceHandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }> }> {
  // Parse URI to extract taskId and resourceType
  const match = uri.match(/task:\/\/([^/]+)\/(.+)/)

  if (!match) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Invalid URI format',
          uri
        }, null, 2)
      }]
    }
  }

  const [, taskId, resourceType] = match

  try {
    if (resourceType === 'context') {
      const task = await getTask(taskId)

      if (!task) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'Task not found',
              taskId
            }, null, 2)
          }]
        }
      }

      // Verify access
      if (task.agentId !== context.agentId) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'Access denied',
              message: 'This task is not assigned to you'
            }, null, 2)
          }]
        }
      }

      // Get related tasks in the same project for context
      const relatedTasks = await listTasks({
        projectId: task.projectId,
        limit: 10
      })

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            task: {
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              priority: task.priority,
              dueDate: task.dueDate,
              startedAt: task.startedAt,
              completedAt: task.completedAt,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt
            },
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
            deliverables: task.deliverables.map(d => ({
              id: d.id,
              name: d.name,
              type: d.type,
              status: d.status,
              content: d.content,
              submittedAt: d.submittedAt,
              reviewedAt: d.reviewedAt
            })),
            relatedTasks: relatedTasks
              .filter(t => t.id !== task.id)
              .slice(0, 5)
              .map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                priority: t.priority
              }))
          }, null, 2)
        }]
      }
    }

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Unknown resource type',
          resourceType
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Failed to fetch task resource',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
