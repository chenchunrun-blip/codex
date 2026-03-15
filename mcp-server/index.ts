/**
 * MCP Server for Task-Agent System
 *
 * This server provides tools and resources for AI agents to interact with
 * the task management system, including:
 * - Task management (list, get, update status)
 * - Deliverable submission and retrieval
 * - Agent information
 * - Project and file resources
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'

import { authenticateRequest, type AgentContext } from './lib/auth'

// Tool imports
import {
  listTasksTool,
  getTaskTool,
  updateTaskStatusTool,
  handleListTasks,
  handleGetTask,
  handleUpdateTaskStatus
} from './tools/tasks'

import {
  submitDeliverableTool,
  getDeliverablesTool,
  handleSubmitDeliverable,
  handleGetDeliverables
} from './tools/deliverables'

import {
  getAgentInfoTool,
  handleGetAgentInfo
} from './tools/agents'

// Resource imports
import {
  projectInfoResource,
  projectTasksResource,
  handleProjectResource
} from './resources/project'

import {
  fileContentResource,
  fileInfoResource,
  handleFileResource
} from './resources/file'

import {
  taskContextResource,
  handleTaskResource
} from './resources/task'

// ============ Server Configuration ============

const SERVER_NAME = 'markdown-collab-mcp-server'
const SERVER_VERSION = '1.0.0'

// ============ Server State ============

let currentAgentContext: AgentContext | null = null

// ============ Server Initialization ============

export function createMCPServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  )

  // ============ Tool Handlers ============

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        listTasksTool,
        getTaskTool,
        updateTaskStatusTool,
        submitDeliverableTool,
        getDeliverablesTool,
        getAgentInfoTool
      ]
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    // Ensure agent is authenticated
    if (!currentAgentContext) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Please provide a valid API key.'
      )
    }

    const context = {
      agentId: currentAgentContext.agentId,
      agentName: currentAgentContext.agentName
    }

    switch (name) {
      case 'list_tasks':
        return handleListTasks(args, context)

      case 'get_task':
        return handleGetTask(args, context)

      case 'update_task_status':
        return handleUpdateTaskStatus(args, context)

      case 'submit_deliverable':
        return handleSubmitDeliverable(args, context)

      case 'get_deliverables':
        return handleGetDeliverables(args, context)

      case 'get_agent_info':
        return handleGetAgentInfo(args, context)

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        )
    }
  })

  // ============ Resource Handlers ============

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        projectInfoResource,
        projectTasksResource,
        fileContentResource,
        fileInfoResource,
        taskContextResource
      ]
    }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params

    // Ensure agent is authenticated
    if (!currentAgentContext) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Please provide a valid API key.'
      )
    }

    const context = {
      agentId: currentAgentContext.agentId
    }

    // Route to appropriate resource handler
    if (uri.startsWith('project://')) {
      return handleProjectResource(uri, context)
    }

    if (uri.startsWith('file://')) {
      return handleFileResource(uri, context)
    }

    if (uri.startsWith('task://')) {
      return handleTaskResource(uri, context)
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      `Unknown resource URI: ${uri}`
    )
  })

  return server
}

// ============ HTTP Handler for Next.js API Route ============

export interface MCPRequestContext {
  headers: Headers
}

export interface MCPResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Create an HTTP handler for the MCP server
 * This can be used in Next.js API routes
 */
export function createMCPHTTPHandler() {
  const server = createMCPServer()

  return async (request: MCPRequestContext): Promise<MCPResponse> => {
    try {
      // Authenticate the request
      const authResult = await authenticateRequest(request.headers)

      if (!authResult.success || !authResult.context) {
        return {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            error: 'Authentication failed',
            message: authResult.error || 'Invalid API key'
          })
        }
      }

      // Set agent context
      currentAgentContext = authResult.context

      // Return server info for now
      // Full MCP protocol over HTTP requires more complex handling
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: SERVER_NAME,
          version: SERVER_VERSION,
          agent: currentAgentContext,
          capabilities: {
            tools: [
              'list_tasks',
              'get_task',
              'update_task_status',
              'submit_deliverable',
              'get_deliverables',
              'get_agent_info'
            ],
            resources: [
              'project://{projectId}/info',
              'project://{projectId}/tasks',
              'file://{fileId}/content',
              'file://{fileId}/info',
              'task://{taskId}/context'
            ]
          }
        })
      }
    } catch (error) {
      console.error('MCP server error:', error)

      return {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    } finally {
      // Clear agent context
      currentAgentContext = null
    }
  }
}

// ============ StdIO Server for CLI/Development ============

/**
 * Start the MCP server with stdio transport
 * This is for running the server as a standalone process
 */
export async function startStdioServer(agentApiKey: string): Promise<void> {
  // Set up authentication using the provided API key
  const { validateAgentApiKey } = await import('./lib/auth')

  const authResult = await validateAgentApiKey(agentApiKey)

  if (!authResult.success || !authResult.context) {
    console.error('Authentication failed:', authResult.error)
    process.exit(1)
  }

  currentAgentContext = authResult.context

  const server = createMCPServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  console.error(`MCP Server running for agent: ${currentAgentContext.displayName}`)
}

// ============ Main Entry Point ============

if (require.main === module) {
  const apiKey = process.env.AGENT_API_KEY || process.argv[2]

  if (!apiKey) {
    console.error('Usage: AGENT_API_KEY=xxx node mcp-server/index.js')
    console.error('Or: node mcp-server/index.js <api-key>')
    process.exit(1)
  }

  startStdioServer(apiKey).catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
}
