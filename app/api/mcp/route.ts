import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { decrypt, secureCompare } from "@/lib/utils/encryption"
import { headers } from "next/headers"

/**
 * POST /api/mcp - MCP Server HTTP endpoint
 *
 * This endpoint receives requests from MCP clients and routes them to the appropriate agent.
 *
 * Authentication: Uses X-API-Key header or Bearer token
 * Content-Type: application/json
 */

// MCP protocol constants
const MCP_VERSION = "2024-11-05"
const MAX_REQUEST_SIZE = 10 * 1024 * 1024 // 10MB

interface MCPRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: "2.0"
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface MCPError {
  code: number
  message: string
  data?: any
}

// MCP error codes
const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR_START: -32000,
  SERVER_ERROR_END: -32099
}

function createMCPError(code: number, message: string, data?: any): MCPError {
  const error: MCPError = { code, message }
  if (data !== undefined) {
    error.data = data
  }
  return error
}

function createMCPResponse(id: string | number, result?: any, error?: MCPError): MCPResponse {
  const response: MCPResponse = {
    jsonrpc: "2.0",
    id
  }
  if (result !== undefined) {
    response.result = result
  }
  if (error !== undefined) {
    response.error = error
  }
  return response
}

async function authenticateRequest(
  reqHeaders: Headers
): Promise<{ success: boolean; agentId?: string; error?: string; code?: string }> {
  const apiKey = reqHeaders.get("X-API-Key") || reqHeaders.get("Authorization")?.replace("Bearer ", "")

  if (!apiKey) {
    return { success: false, error: "Missing API key", code: "UNAUTHORIZED" }
  }

  // Validate API key format (basic check)
  if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 256) {
    return { success: false, error: "Invalid API key format", code: "INVALID_REQUEST_PAYLOAD" }
  }

  // Find agent by matching decrypted API key
  const agents = await db.agent.findMany({
    where: {
      apiKeyEncrypted: { not: null },
      isActive: true
    },
    select: {
      id: true,
      apiKeyEncrypted: true,
      name: true
    }
  })

  for (const agent of agents) {
    if (agent.apiKeyEncrypted) {
      try {
        const decryptedKey = decrypt(agent.apiKeyEncrypted)
        // SECURITY: Use timing-safe comparison to prevent timing attacks
        if (decryptedKey && secureCompare(decryptedKey, apiKey)) {
          return { success: true, agentId: agent.id }
        }
      } catch {
        // Skip if decryption fails
        continue
      }
    }
  }

  return { success: false, error: "Invalid API key", code: "UNAUTHORIZED" }
}

async function handleMCPRequest(request: MCPRequest, agentId: string): Promise<MCPResponse> {
  const { method, params, id } = request

  // Get agent details
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      tasks: {
        where: {
          status: { in: ["PENDING", "IN_PROGRESS"] }
        },
        orderBy: { createdAt: "asc" },
        take: 1
      }
    }
  })

  if (!agent) {
    return createMCPResponse(
      id,
      undefined,
      createMCPError(MCP_ERROR_CODES.INTERNAL_ERROR, "Agent not found")
    )
  }

  // Handle different MCP methods
  switch (method) {
    case "initialize":
      return createMCPResponse(id, {
        protocolVersion: MCP_VERSION,
        serverInfo: {
          name: agent.displayName,
          version: "1.0.0"
        },
        capabilities: {
          tools: {},
          resources: {}
        }
      })

    case "tools/list":
      return createMCPResponse(id, {
        tools: (agent.capabilities as any) || [
          {
            name: "generate_markdown",
            description: "Generate markdown content",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string", description: "Content generation prompt" }
              },
              required: ["prompt"]
            }
          },
          {
            name: "analyze_task",
            description: "Analyze task requirements",
            inputSchema: {
              type: "object",
              properties: {
                taskId: { type: "string", description: "Task ID to analyze" }
              },
              required: ["taskId"]
            }
          }
        ]
      })

    case "tools/call":
      const { name, arguments: toolArgs } = params || {}
      // This would integrate with the actual tool execution logic
      return createMCPResponse(id, {
        content: [
          {
            type: "text",
            text: `Tool ${name} called with args: ${JSON.stringify(toolArgs)}`
          }
        ]
      })

    case "resources/list":
      return createMCPResponse(id, {
        resources: []
      })

    case "prompts/list":
      return createMCPResponse(id, {
        prompts: []
      })

    default:
      return createMCPResponse(
        id,
        undefined,
        createMCPError(MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${method}`)
      )
  }
}

export async function POST(req: Request) {
  try {
    // Check content size
    const contentLength = req.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
      return NextResponse.json(
        createMCPResponse(
          "null",
          undefined,
          createMCPError(MCP_ERROR_CODES.INVALID_REQUEST, "Request too large")
        ),
        { status: 413 }
      )
    }

    // Authenticate request
    const headersList = await headers()
    const authResult = await authenticateRequest(headersList)

    if (!authResult.success) {
      return NextResponse.json(
        createMCPResponse(
          "null",
          undefined,
          createMCPError(
            MCP_ERROR_CODES.INTERNAL_ERROR,
            authResult.error || "Authentication failed",
            { code: authResult.code || "INTERNAL_ERROR" }
          )
        ),
        { status: 401 }
      )
    }

    // Parse request body
    let requestBody: MCPRequest
    try {
      requestBody = await req.json()
    } catch {
      return NextResponse.json(
        createMCPResponse(
          "null",
          undefined,
          createMCPError(MCP_ERROR_CODES.PARSE_ERROR, "Invalid JSON", { code: "INVALID_REQUEST_PAYLOAD" })
        ),
        { status: 400 }
      )
    }

    if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
      return NextResponse.json(
        createMCPResponse(
          "null",
          undefined,
          createMCPError(MCP_ERROR_CODES.INVALID_REQUEST, "Invalid request body", { code: "INVALID_REQUEST_PAYLOAD" })
        ),
        { status: 400 }
      )
    }

    // Validate JSON-RPC request format
    if (!requestBody.jsonrpc || requestBody.jsonrpc !== "2.0") {
      return NextResponse.json(
        createMCPResponse(
          requestBody.id || "null",
          undefined,
          createMCPError(MCP_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC version", {
            code: "INVALID_REQUEST_PAYLOAD"
          })
        ),
        { status: 400 }
      )
    }

    if (!requestBody.method) {
      return NextResponse.json(
        createMCPResponse(
          requestBody.id || "null",
          undefined,
          createMCPError(MCP_ERROR_CODES.INVALID_REQUEST, "Missing method", {
            code: "INVALID_REQUEST_PAYLOAD"
          })
        ),
        { status: 400 }
      )
    }

    // Handle the request
    const response = await handleMCPRequest(requestBody, authResult.agentId!)

    // Get allowed origins for CORS
    const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS
      ? process.env.MCP_ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:3001']
    const origin = req.headers.get('origin')

    const jsonResponse = NextResponse.json(response)

    // Add CORS header if origin is allowed
    if (origin && allowedOrigins.includes(origin)) {
      jsonResponse.headers.set('Access-Control-Allow-Origin', origin)
    }

    return jsonResponse
  } catch (error) {
    console.error("MCP request error:", error)
    return NextResponse.json(
      createMCPResponse(
        "null",
        undefined,
        createMCPError(MCP_ERROR_CODES.INTERNAL_ERROR, "Internal server error", { code: "INTERNAL_ERROR" })
      ),
      { status: 500 }
    )
  }
}

// OPTIONS for CORS preflight
export async function OPTIONS(req: Request) {
  // Get allowed origins from environment variable
  const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS
    ? process.env.MCP_ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001']

  const origin = req.headers.get('origin')

  // Validate origin
  if (!origin || !allowedOrigins.includes(origin)) {
    return new NextResponse(null, { status: 403 })
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
      "Access-Control-Max-Age": "86400"
    }
  })
}
