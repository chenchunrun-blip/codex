/**
 * Authentication utilities for MCP Server
 * Validates API keys for agents and provides agent context
 */

import { db } from '../../lib/db'
import { decrypt } from '../../lib/utils/encryption'

export interface AgentContext {
  agentId: string
  agentName: string
  displayName: string
  capabilities?: string[]
  modelConfig?: Record<string, unknown>
}

export interface AuthResult {
  success: boolean
  context?: AgentContext
  error?: string
}

/**
 * Validate an agent's API key
 * @param apiKey - The API key to validate
 * @returns AuthResult with agent context if successful
 */
export async function validateAgentApiKey(apiKey: string): Promise<AuthResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'API key is required'
    }
  }

  try {
    // Find all active agents
    const agents = await db.agent.findMany({
      where: {
        isActive: true,
        apiKeyEncrypted: {
          not: null
        }
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        capabilities: true,
        modelConfig: true,
        apiKeyEncrypted: true
      }
    })

    // Check each agent's decrypted API key
    for (const agent of agents) {
      if (!agent.apiKeyEncrypted) continue

      try {
        const decryptedKey = decrypt(agent.apiKeyEncrypted)
        if (decryptedKey === apiKey) {
          return {
            success: true,
            context: {
              agentId: agent.id,
              agentName: agent.name,
              displayName: agent.displayName,
              capabilities: agent.capabilities as string[] | undefined,
              modelConfig: agent.modelConfig as Record<string, unknown> | undefined
            }
          }
        }
      } catch {
        // Decryption failed, skip this agent
        continue
      }
    }

    return {
      success: false,
      error: 'Invalid API key'
    }
  } catch (error) {
    console.error('Error validating agent API key:', error)
    return {
      success: false,
      error: 'Authentication failed'
    }
  }
}

/**
 * Extract API key from request headers
 * Supports both Bearer token and x-api-key header formats
 */
export function extractApiKey(headers: Headers): string | null {
  const authHeader = headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const apiKeyHeader = headers.get('x-api-key')
  if (apiKeyHeader) {
    return apiKeyHeader
  }

  return null
}

/**
 * Authenticate a request and return agent context
 */
export async function authenticateRequest(headers: Headers): Promise<AuthResult> {
  const apiKey = extractApiKey(headers)

  if (!apiKey) {
    return {
      success: false,
      error: 'API key is required. Use Authorization: Bearer <key> or x-api-key: <key>'
    }
  }

  return validateAgentApiKey(apiKey)
}
