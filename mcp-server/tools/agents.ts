/**
 * MCP Tools for Agent Information
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { getAgentInfo, getAgentByName } from '../lib/db'

// ============ Schemas ============

export const GetAgentInfoSchema = z.object({
  agentId: z.string().optional(),
  agentName: z.string().optional()
}).refine(data => data.agentId || data.agentName, {
  message: 'Either agentId or agentName must be provided'
})

// ============ Tool Definitions ============

export const getAgentInfoTool: Tool = {
  name: 'get_agent_info',
  description: 'Get information about an agent by ID or name. Returns configuration, capabilities, and task statistics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agentId: {
        type: 'string' as const,
        description: 'The ID of the agent'
      },
      agentName: {
        type: 'string' as const,
        description: 'The name of the agent'
      }
    }
  }
}

// ============ Tool Handlers ============

export interface ToolHandlerContext {
  agentId: string
  agentName: string
}

export async function handleGetAgentInfo(
  args: unknown,
  context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = GetAgentInfoSchema.safeParse(args)

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

  const { agentId, agentName } = parsed.data

  try {
    // Use provided agentId/agentName or default to current agent
    const lookupId = agentId || context.agentId
    const lookupName = agentName || context.agentName

    const agent = lookupId
      ? await getAgentInfo(lookupId)
      : await getAgentByName(lookupName)

    if (!agent) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Agent not found',
            agentId: lookupId,
            agentName: lookupName
          }, null, 2)
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: agent.id,
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description,
          type: agent.type,
          capabilities: agent.capabilities,
          modelConfig: agent.modelConfig,
          apiEndpoint: agent.apiEndpoint,
          isActive: agent.isActive,
          taskCount: agent._count.tasks,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to get agent info',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
