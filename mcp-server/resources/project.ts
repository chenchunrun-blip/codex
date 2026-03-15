/**
 * MCP Resources for Project Information
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { getProjectInfo } from '../lib/db'

// ============ Resource Definitions ============

export const projectInfoResource: Resource = {
  uri: 'project://{projectId}/info',
  name: 'Project Information',
  description: 'Get detailed information about a project including metadata and team info',
  mimeType: 'application/json'
}

export const projectTasksResource: Resource = {
  uri: 'project://{projectId}/tasks',
  name: 'Project Tasks',
  description: 'Get all tasks associated with a project',
  mimeType: 'application/json'
}

// ============ Resource Handlers ============

export interface ResourceHandlerContext {
  agentId: string
}

export async function handleProjectResource(
  uri: string,
  context: ResourceHandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }> }> {
  // Parse URI to extract projectId
  const match = uri.match(/project:\/\/([^/]+)\/(.+)/)

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

  const [, projectId, resourceType] = match

  try {
    if (resourceType === 'info') {
      const project = await getProjectInfo(projectId)

      if (!project) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'Project not found',
              projectId
            }, null, 2)
          }]
        }
      }

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            id: project.id,
            name: project.name,
            description: project.description,
            status: project.status,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt
          }, null, 2)
        }]
      }
    }

    if (resourceType === 'tasks') {
      const { listTasks } = await import('../lib/db')

      const tasks = await listTasks({
        projectId,
        limit: 100
      })

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            projectId,
            tasks: tasks.map(task => ({
              id: task.id,
              title: task.title,
              status: task.status,
              priority: task.priority,
              agent: task.agent ? {
                id: task.agent.id,
                name: task.agent.name,
                displayName: task.agent.displayName
              } : null,
              dueDate: task.dueDate,
              createdAt: task.createdAt
            })),
            count: tasks.length
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
          error: 'Failed to fetch project resource',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
