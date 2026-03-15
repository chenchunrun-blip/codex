/**
 * MCP Test Client
 * Tests the MCP Server by creating an agent and making requests
 */

import { encrypt } from '../lib/utils/encryption'
import { db } from '../lib/db'

const TEST_API_KEY = 'test-api-key-for-mcp-' + Date.now()

async function setupTestAgent() {
  console.log('🔧 Setting up test agent...\n')

  // Check if test agent already exists
  const existingAgent = await db.agent.findFirst({
    where: { name: 'test-mcp-agent' }
  })

  if (existingAgent) {
    console.log('✅ Test agent already exists')
    return { agent: existingAgent, apiKey: TEST_API_KEY }
  }

  // Encrypt the API key
  const encryptedKey = encrypt(TEST_API_KEY)

  // Create test agent
  const agent = await db.agent.create({
    data: {
      name: 'test-mcp-agent',
      displayName: 'Test MCP Agent',
      description: 'Agent for testing MCP server',
      type: 'AI',
      capabilities: ['text-generation', 'task-management'],
      apiKeyEncrypted: encryptedKey,
      isActive: true
    }
  })

  console.log('✅ Test agent created:', agent.id)
  return { agent, apiKey: TEST_API_KEY }
}

async function testMCPServer(apiKey: string) {
  console.log('\n🧪 Testing MCP Server...\n')

  const baseUrl = 'http://localhost:3002'

  // Test 1: Health check
  console.log('Test 1: Health Check')
  const healthRes = await fetch(`${baseUrl}/health`)
  console.log('  Status:', healthRes.status)
  console.log('  Response:', await healthRes.json())
  console.log('')

  // Test 2: Server info
  console.log('Test 2: Server Info')
  const infoRes = await fetch(`${baseUrl}/`)
  console.log('  Status:', infoRes.status)
  console.log('  Response:', await infoRes.json())
  console.log('')

  // Test 3: SSE connection (without API key - should fail)
  console.log('Test 3: SSE without API key (expect 401)')
  const sseNoAuthRes = await fetch(`${baseUrl}/sse`)
  console.log('  Status:', sseNoAuthRes.status)
  console.log('  Response:', await sseNoAuthRes.json())
  console.log('')

  // Test 4: SSE connection (with API key)
  console.log('Test 4: SSE with API key')
  try {
    const sseRes = await fetch(`${baseUrl}/sse`, {
      headers: {
        'X-API-Key': apiKey
      }
    })
    console.log('  Status:', sseRes.status)
    console.log('  Headers:', Object.fromEntries(sseRes.headers.entries()))

    // Read first few chunks
    const reader = sseRes.body?.getReader()
    if (reader) {
      console.log('  Reading SSE stream...')
      const { value, done } = await reader.read()
      if (!done && value) {
        const text = new TextDecoder().decode(value)
        console.log('  First SSE message:', text.slice(0, 500))
      }
      reader.releaseLock()
    }
  } catch (error) {
    console.log('  Error:', error instanceof Error ? error.message : String(error))
  }
  console.log('')

  // Test 5: Create a test task
  console.log('Test 5: Create test task in database')
  const project = await db.project.findFirst()
  if (project) {
    const task = await db.task.create({
      data: {
        title: 'Test Task for MCP',
        description: 'This is a test task created by the MCP test client',
        projectId: project.id,
        status: 'PENDING',
        priority: 2
      }
    })
    console.log('  Created task:', task.id)
    console.log('  Task title:', task.title)
  } else {
    console.log('  No project found, skipping task creation')
  }

  console.log('\n✅ All tests completed!')
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...')
  await db.$disconnect()
}

async function main() {
  try {
    const { apiKey } = await setupTestAgent()
    await testMCPServer(apiKey)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await cleanup()
  }
}

main()
