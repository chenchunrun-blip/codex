# MCP Server for Task-Agent System

This is the Model Context Protocol (MCP) server implementation for the markdown-collab task-agent system.

## Overview

The MCP server provides tools and resources for AI agents to interact with the task management system, including:

- **Task Management**: List, retrieve, and update task status
- **Deliverable Management**: Submit and retrieve deliverables
- **Agent Information**: Query agent configuration and capabilities
- **Resources**: Access project info, file content, and task context

## Directory Structure

```
mcp-server/
├── index.ts              # Server entry + HTTP handler
├── tools/
│   ├── tasks.ts          # list_tasks, get_task, update_task_status
│   ├── deliverables.ts   # submit_deliverable, get_deliverables
│   └── agents.ts         # get_agent_info
├── resources/
│   ├── project.ts        # project://{projectId}/info, project://{projectId}/tasks
│   ├── file.ts           # file://{fileId}/content, file://{fileId}/info
│   └── task.ts           # task://{taskId}/context
└── lib/
    ├── auth.ts           # API Key validation for agents
    └── db.ts             # Database operations
```

## Tools

### list_tasks
List tasks assigned to the authenticated agent with optional filtering.

**Parameters:**
- `status` (optional): Filter by task status (PENDING, IN_PROGRESS, REVIEW, COMPLETED, CANCELLED)
- `projectId` (optional): Filter by project ID
- `limit` (optional): Maximum number of tasks to return (default: 50, max: 100)
- `offset` (optional): Number of tasks to skip for pagination

### get_task
Get detailed information about a specific task including its deliverables.

**Parameters:**
- `taskId` (required): The ID of the task to retrieve

### update_task_status
Update the status of a task. Automatically sets startedAt/completedAt timestamps.

**Parameters:**
- `taskId` (required): The ID of the task to update
- `status` (required): The new status (PENDING, IN_PROGRESS, REVIEW, COMPLETED, CANCELLED)
- `notes` (optional): Notes about the status change

### submit_deliverable
Submit a deliverable for a task. Optionally create a file for the deliverable content.

**Parameters:**
- `taskId` (required): The ID of the task
- `name` (required): Name of the deliverable
- `type` (required): Type of deliverable (markdown, code, report, image, etc.)
- `content` (required): The content of the deliverable
- `createFile` (optional): Whether to create a file for this deliverable (default: false)
- `fileName` (optional): Name of the file to create
- `fileType` (optional): Type of file to create

### get_deliverables
Get all deliverables for a specific task.

**Parameters:**
- `taskId` (required): The ID of the task

### get_agent_info
Get information about an agent by ID or name. Returns configuration, capabilities, and task statistics.

**Parameters:**
- `agentId` (optional): The ID of the agent
- `agentName` (optional): The name of the agent

## Resources

### project://{projectId}/info
Get detailed information about a project including metadata.

### project://{projectId}/tasks
Get all tasks associated with a project.

### file://{fileId}/content
Get the content of a file by its ID.

### file://{fileId}/info
Get metadata about a file without its content.

### task://{taskId}/context
Get full context for a task including related project, deliverables, and history.

## Authentication

Agents authenticate using their API key via:
- `Authorization: Bearer <api-key>` header, or
- `x-api-key: <api-key>` header

The API key is validated against the encrypted keys stored in the Agent model.

## Usage

### Standalone (StdIO)
```bash
AGENT_API_KEY=your-key node mcp-server/index.js
```

### HTTP (Next.js API Route)
The server includes `createMCPHTTPHandler()` for use in Next.js API routes at `/api/mcp`.

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Type check
npx tsc --noEmit mcp-server/index.ts
```

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@prisma/client` - Database client
- `zod` - Schema validation
