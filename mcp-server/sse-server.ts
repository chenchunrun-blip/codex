/**
 * MCP SSE (Server-Sent Events) Server
 *
 * This server runs as a standalone HTTP service that external MCP clients
 * can connect to via Server-Sent Events for real-time communication.
 *
 * Endpoints:
 * - GET /sse - SSE connection endpoint for receiving messages
 * - POST /messages - Endpoint for sending messages to the server
 */

import express from 'express'
import cors from 'cors'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'

// Load environment variables from parent directory
import { config } from 'dotenv'
config({ path: '../.env' })

// Import local modules
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

import {
  getTeamInfoTool,
  listTeamMembersTool,
  getProjectTeamAssignmentsTool,
  handleGetTeamInfo,
  handleListTeamMembers,
  handleGetProjectTeamAssignments
} from './tools/teams'

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
const PORT = process.env.MCP_SERVER_PORT || 3002

// ============ Express App ============

const app = express()
app.use(cors())
app.use(express.json())

// Map to store transports by session ID
const transports = new Map<string, { transport: SSEServerTransport; agentContext: AgentContext }>()

// ============ MCP Server Factory ============

function createMCPServer(agentContext: AgentContext): Server {
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
        getAgentInfoTool,
        getTeamInfoTool,
        listTeamMembersTool,
        getProjectTeamAssignmentsTool
      ]
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const context = {
      agentId: agentContext.agentId,
      agentName: agentContext.agentName
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

      case 'get_team_info':
        return handleGetTeamInfo(args, context)

      case 'list_team_members':
        return handleListTeamMembers(args, context)

      case 'get_project_team_assignments':
        return handleGetProjectTeamAssignments(args, context)

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

    const context = {
      agentId: agentContext.agentId
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

// ============ Routes ============

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: SERVER_NAME,
    version: SERVER_VERSION,
    sessions: transports.size
  })
})

// SSE endpoint - clients connect here to receive messages
app.get('/sse', async (req, res) => {
  // Authenticate request
  const apiKey = req.headers['x-api-key'] as string || req.headers.authorization?.replace('Bearer ', '')

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key. Use X-API-Key header or Authorization: Bearer <key>' })
    return
  }

  const authResult = await authenticateRequest(new Headers(req.headers as Record<string, string>))

  if (!authResult.success || !authResult.context) {
    res.status(401).json({ error: authResult.error || 'Authentication failed' })
    return
  }

  console.log(`MCP client connected: ${authResult.context.displayName} (${authResult.context.agentId})`)

  // Create transport
  const transport = new SSEServerTransport('/messages', res)

  // Store transport with session ID
  transports.set(transport.sessionId, { transport, agentContext: authResult.context })

  // Create and connect MCP server
  const server = createMCPServer(authResult.context)
  await server.connect(transport)

  // Handle disconnect
  transport.onclose = () => {
    console.log(`MCP client disconnected: ${authResult.context!.displayName}`)
    transports.delete(transport.sessionId)
  }
})

// Message endpoint - clients POST here to send messages
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string

  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId query parameter' })
    return
  }

  const session = transports.get(sessionId)

  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  // Handle the message
  await session.transport.handlePostMessage(req, res)
})

// Server info endpoint
app.get('/', (_req, res) => {
  res.json({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocol: 'MCP',
    endpoints: {
      sse: '/sse',
      messages: '/messages?sessionId={sessionId}',
      health: '/health'
    },
    authentication: {
      type: 'api-key',
      header: 'X-API-Key or Authorization: Bearer <key>'
    }
  })
})

// ============ Start Server ============

app.listen(PORT, () => {
  console.log(`✅ MCP SSE Server running on port ${PORT}`)
  console.log(`📡 SSE Endpoint: http://localhost:${PORT}/sse`)
  console.log(`💬 Message Endpoint: http://localhost:${PORT}/messages?sessionId={sessionId}`)
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`)
  console.log('')
  console.log('To connect, send a GET request to /sse with your API key.')
  console.log('Then POST messages to /messages?sessionId={sessionId}')
})
