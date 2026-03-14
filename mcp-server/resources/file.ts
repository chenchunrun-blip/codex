/**
 * MCP Resources for File Content
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { getFileContent } from '../lib/db'

// ============ Resource Definitions ============

export const fileContentResource: Resource = {
  uri: 'file://{fileId}/content',
  name: 'File Content',
  description: 'Get the content of a file by its ID',
  mimeType: 'text/markdown'
}

export const fileInfoResource: Resource = {
  uri: 'file://{fileId}/info',
  name: 'File Information',
  description: 'Get metadata about a file without its content',
  mimeType: 'application/json'
}

// ============ Resource Handlers ============

export interface ResourceHandlerContext {
  agentId: string
}

export async function handleFileResource(
  uri: string,
  context: ResourceHandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }> }> {
  // Parse URI to extract fileId and resourceType
  const match = uri.match(/file:\/\/([^/]+)\/(.+)/)

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

  const [, fileId, resourceType] = match

  try {
    if (resourceType === 'content') {
      const result = await getFileContent(fileId)

      if (!result) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'File not found',
              fileId
            }, null, 2)
          }]
        }
      }

      const { file, content } = result

      // Determine appropriate MIME type based on file type
      const mimeTypes: Record<string, string> = {
        'PROBLEM_DEFINITION': 'text/markdown',
        'SOLUTION_DESIGN': 'text/markdown',
        'EXECUTION_TRACKING': 'text/markdown',
        'RETROSPECTIVE_SUMMARY': 'text/markdown',
        'CUSTOM': 'text/markdown'
      }

      const mimeType = mimeTypes[file.fileType] || 'text/plain'

      return {
        contents: [{
          uri,
          mimeType,
          text: content
        }]
      }
    }

    if (resourceType === 'info') {
      const result = await getFileContent(fileId)

      if (!result) {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: 'File not found',
              fileId
            }, null, 2)
          }]
        }
      }

      const { file } = result

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            id: file.id,
            name: file.name,
            fileType: file.fileType,
            status: file.status,
            projectName: file.projectName,
            templateType: file.templateType,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            lastAutoSave: file.lastAutoSave,
            storageId: file.storageId,
            projectId: file.projectId,
            creatorId: file.creatorId
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
          error: 'Failed to fetch file resource',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
