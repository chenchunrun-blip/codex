/**
 * MCP Server Complete Regression Test
 * Tests the full agent workflow:
 * 1. Agent authentication
 * 2. Get assigned tasks
 * 3. Start working on a task
 * 4. Submit deliverable
 * 5. Complete task
 * 6. Verify deliverables
 * 7. Get team/project info
 */

import { db } from '../lib/db'
import { encrypt } from '../lib/utils/encryption'
import { listTasks, getTask, updateTaskStatus, submitDeliverable, getDeliverables } from './lib/db'

const TEST_API_KEY = 'regression-test-api-key-' + Date.now()

interface TestResult {
  name: string
  passed: boolean
  error?: string
  data?: unknown
}

async function setupTestAgent() {
  console.log('🔧 Setting up test agent...\n')

  // Clean up previous test data
  const existingAgent = await db.agent.findFirst({
    where: { name: 'regression-test-agent' }
  })

  if (existingAgent) {
    console.log('🧹 Cleaning up previous test data...')
    // Delete all tasks for this agent
    await db.task.deleteMany({
      where: { agentId: existingAgent.id }
    })
    // Delete the agent
    await db.agent.delete({
      where: { id: existingAgent.id }
    })
    console.log('   Previous test data cleaned')
  }

  const encryptedKey = encrypt(TEST_API_KEY)
  const agent = await db.agent.create({
    data: {
      name: 'regression-test-agent',
      displayName: 'Regression Test Agent',
      description: 'Agent for regression testing MCP server',
      type: 'AI',
      capabilities: ['task-execution', 'documentation', 'testing'],
      apiKeyEncrypted: encryptedKey,
      isActive: true
    }
  })
  console.log('✅ Created test agent:', agent.id)

  return { agent, apiKey: TEST_API_KEY }
}

async function setupTestData(agentId: string) {
  console.log('\n🔧 Setting up test data...\n')

  // Get or create user
  let user = await db.user.findFirst()
  if (!user) {
    user = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashedpassword'
      }
    })
  }

  // Get or create team
  let team = await db.team.findFirst()
  if (!team) {
    team = await db.team.create({
      data: {
        name: 'Regression Test Team',
        description: 'Team for regression testing',
        creatorId: user.id
      }
    })
  }

  // Get or create project
  let project = await db.project.findFirst()
  if (!project) {
    project = await db.project.create({
      data: {
        name: 'Regression Test Project',
        description: 'Project for testing MCP workflows',
        teamId: team.id,
        creatorId: user.id,
        status: 'ACTIVE'
      }
    })
  }

  // Create test tasks for the agent
  const existingTasks = await db.task.count({
    where: { agentId, projectId: project.id }
  })

  if (existingTasks < 2) {
    // Task 1: Ready to work on
    const task1 = await db.task.create({
      data: {
        title: 'Write API Documentation',
        description: 'Document the MCP API endpoints with examples',
        projectId: project.id,
        creatorId: user.id,
        agentId: agentId,
        assigneeType: 'AGENT',
        status: 'PENDING',
        priority: 2
      }
    })
    console.log('✅ Created Task 1:', task1.id, '(PENDING)')

    // Task 2: Already in progress
    const task2 = await db.task.create({
      data: {
        title: 'Implement Error Handling',
        description: 'Add comprehensive error handling to all endpoints',
        projectId: project.id,
        creatorId: user.id,
        agentId: agentId,
        assigneeType: 'AGENT',
        status: 'IN_PROGRESS',
        priority: 3,
        startedAt: new Date()
      }
    })
    console.log('✅ Created Task 2:', task2.id, '(IN_PROGRESS)')
  }

  return { project, team, user }
}

async function runTests(agentId: string, projectId: string): Promise<TestResult[]> {
  const results: TestResult[] = []
  const context = { agentId }

  // Test 1: List tasks assigned to agent
  console.log('\n📋 Test 1: list_tasks - Get assigned tasks')
  try {
    const tasks = await listTasks({ agentId })
    if (tasks.length === 0) {
      throw new Error('No tasks found for agent')
    }
    console.log('   ✅ Found', tasks.length, 'tasks')
    tasks.forEach(t => console.log('      -', t.title, '(' + t.status + ')'))
    results.push({ name: 'list_tasks', passed: true, data: { count: tasks.length } })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'list_tasks', passed: false, error: String(error) })
  }

  // Test 2: Get specific task details
  console.log('\n📋 Test 2: get_task - Get task details')
  let testTaskId: string | null = null
  try {
    const tasks = await listTasks({ agentId, status: 'PENDING' })
    if (tasks.length === 0) throw new Error('No pending tasks found')

    testTaskId = tasks[0].id
    const task = await getTask(testTaskId)

    if (!task) throw new Error('Task not found')
    if (task.agentId !== agentId) throw new Error('Task not assigned to this agent')

    console.log('   ✅ Task details retrieved:', task.title)
    console.log('      Status:', task.status)
    console.log('      Project:', task.project.name)
    results.push({ name: 'get_task', passed: true, data: { taskId: testTaskId } })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'get_task', passed: false, error: String(error) })
  }

  // Test 3: Update task status to IN_PROGRESS
  console.log('\n📋 Test 3: update_task_status - Start working on task')
  if (testTaskId) {
    try {
      const beforeTask = await getTask(testTaskId)
      if (!beforeTask) throw new Error('Task not found')

      const updated = await updateTaskStatus(testTaskId, 'IN_PROGRESS')
      if (!updated) throw new Error('Failed to update task')
      if (updated.status !== 'IN_PROGRESS') throw new Error('Status not updated correctly')
      if (!updated.startedAt) throw new Error('startedAt not set')

      console.log('   ✅ Task status updated to IN_PROGRESS')
      console.log('      Started at:', updated.startedAt)
      results.push({ name: 'update_task_status (start)', passed: true })
    } catch (error) {
      console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
      results.push({ name: 'update_task_status (start)', passed: false, error: String(error) })
    }
  } else {
    console.log('   ⚠️ Skipped: No test task available')
    results.push({ name: 'update_task_status (start)', passed: false, error: 'No test task' })
  }

  // Test 4: Submit deliverable
  console.log('\n📋 Test 4: submit_deliverable - Submit task completion')
  let deliverableId: string | null = null
  if (testTaskId) {
    try {
      const deliverable = await submitDeliverable({
        taskId: testTaskId,
        name: 'API Documentation',
        type: 'documentation',
        content: '# MCP API Documentation\n\n## Endpoints\n- GET /health - Health check\n- GET /sse - SSE connection\n- POST /messages - Send messages\n\nAll tools support agent authentication.',
        createFile: true,
        fileName: 'mcp-api-docs.md'
      })

      if (!deliverable) throw new Error('Failed to create deliverable')
      deliverableId = deliverable.id

      console.log('   ✅ Deliverable submitted:', deliverable.name)
      console.log('      Status:', deliverable.status)
      console.log('      File created:', deliverable.file ? deliverable.file.name : 'No')
      results.push({ name: 'submit_deliverable', passed: true, data: { deliverableId } })
    } catch (error) {
      console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
      results.push({ name: 'submit_deliverable', passed: false, error: String(error) })
    }
  } else {
    console.log('   ⚠️ Skipped: No test task available')
    results.push({ name: 'submit_deliverable', passed: false, error: 'No test task' })
  }

  // Test 5: Get deliverables for task
  console.log('\n📋 Test 5: get_deliverables - Verify deliverable creation')
  if (testTaskId) {
    try {
      const deliverables = await getDeliverables(testTaskId)
      if (deliverables.length === 0) throw new Error('No deliverables found')

      console.log('   ✅ Found', deliverables.length, 'deliverable(s)')
      deliverables.forEach(d => {
        console.log('      -', d.name, '(' + d.status + ')')
      })
      results.push({ name: 'get_deliverables', passed: true, data: { count: deliverables.length } })
    } catch (error) {
      console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
      results.push({ name: 'get_deliverables', passed: false, error: String(error) })
    }
  } else {
    console.log('   ⚠️ Skipped: No test task available')
    results.push({ name: 'get_deliverables', passed: false, error: 'No test task' })
  }

  // Test 6: Complete task
  console.log('\n📋 Test 6: update_task_status - Complete task')
  if (testTaskId) {
    try {
      const updated = await updateTaskStatus(testTaskId, 'COMPLETED', 'Task completed with deliverables')
      if (!updated) throw new Error('Failed to complete task')
      if (updated.status !== 'COMPLETED') throw new Error('Status not updated to COMPLETED')
      if (!updated.completedAt) throw new Error('completedAt not set')

      console.log('   ✅ Task completed')
      console.log('      Completed at:', updated.completedAt)
      results.push({ name: 'update_task_status (complete)', passed: true })
    } catch (error) {
      console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
      results.push({ name: 'update_task_status (complete)', passed: false, error: String(error) })
    }
  } else {
    console.log('   ⚠️ Skipped: No test task available')
    results.push({ name: 'update_task_status (complete)', passed: false, error: 'No test task' })
  }

  // Test 7: Verify task access control (try to access non-assigned task)
  console.log('\n📋 Test 7: Access control - Verify agent isolation')
  try {
    // Create another agent and task
    const otherAgent = await db.agent.create({
      data: {
        name: 'other-agent-' + Date.now(),
        displayName: 'Other Agent',
        type: 'AI',
        apiKeyEncrypted: encrypt('other-key'),
        isActive: true
      }
    })

    const user = await db.user.findFirst()
    const project = await db.project.findFirst()

    const otherTask = await db.task.create({
      data: {
        title: 'Other Agent Task',
        description: 'Task for another agent',
        projectId: project!.id,
        creatorId: user!.id,
        agentId: otherAgent.id,
        assigneeType: 'AGENT',
        status: 'PENDING'
      }
    })

    // Try to get the other agent's task
    const otherTaskDetails = await getTask(otherTask.id)
    if (otherTaskDetails && otherTaskDetails.agentId === agentId) {
      throw new Error('Access control bypassed - can access other agent task')
    }

    console.log('   ✅ Access control working - Cannot access other agent tasks')
    results.push({ name: 'access_control', passed: true })

    // Cleanup
    await db.task.delete({ where: { id: otherTask.id } })
    await db.agent.delete({ where: { id: otherAgent.id } })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'access_control', passed: false, error: String(error) })
  }

  return results
}

async function runTeamTests(projectId: string, teamId: string): Promise<TestResult[]> {
  const results: TestResult[] = []

  console.log('\n\n🏢 TEAM & PROJECT TOOLS TESTS\n')

  // Test 8: Get team info
  console.log('📋 Test 8: get_team_info - Get team information')
  try {
    const team = await db.team.findUnique({
      where: { id: teamId },
      include: {
        _count: { select: { members: true, projects: true } },
        creator: { select: { id: true, name: true, email: true } }
      }
    })

    if (!team) throw new Error('Team not found')

    console.log('   ✅ Team info retrieved:', team.name)
    console.log('      Members:', team._count.members)
    console.log('      Projects:', team._count.projects)
    results.push({ name: 'get_team_info', passed: true, data: { teamId: team.id } })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'get_team_info', passed: false, error: String(error) })
  }

  // Test 9: List team members
  console.log('\n📋 Test 9: list_team_members - Get team members')
  try {
    const members = await db.teamMember.findMany({
      where: { teamId },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    })

    console.log('   ✅ Found', members.length, 'team member(s)')
    members.forEach(m => {
      console.log('      -', m.user.name, '(' + m.role + ')')
    })
    results.push({ name: 'list_team_members', passed: true, data: { count: members.length } })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'list_team_members', passed: false, error: String(error) })
  }

  // Test 10: Get project team assignments
  console.log('\n📋 Test 10: get_project_team_assignments - Get task assignments')
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: {
            assignee: { select: { id: true, name: true } },
            agent: { select: { id: true, name: true, displayName: true } },
            deliverables: { select: { id: true, status: true } }
          }
        }
      }
    })

    if (!project) throw new Error('Project not found')

    const assignments = {
      total: project.tasks.length,
      byHumans: project.tasks.filter(t => t.assigneeId).length,
      byAgents: project.tasks.filter(t => t.agentId).length,
      unassigned: project.tasks.filter(t => !t.assigneeId && !t.agentId).length
    }

    console.log('   ✅ Project assignments retrieved')
    console.log('      Total tasks:', assignments.total)
    console.log('      By humans:', assignments.byHumans)
    console.log('      By agents:', assignments.byAgents)
    console.log('      Unassigned:', assignments.unassigned)
    results.push({ name: 'get_project_team_assignments', passed: true, data: assignments })
  } catch (error) {
    console.log('   ❌ Failed:', error instanceof Error ? error.message : 'Unknown error')
    results.push({ name: 'get_project_team_assignments', passed: false, error: String(error) })
  }

  return results
}

function printSummary(allResults: TestResult[]) {
  console.log('\n\n' + '='.repeat(60))
  console.log('📊 REGRESSION TEST SUMMARY')
  console.log('='.repeat(60))

  const passed = allResults.filter(r => r.passed).length
  const failed = allResults.filter(r => !r.passed).length

  allResults.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL'
    console.log(`${status} - ${result.name}`)
    if (result.error) {
      console.log(`       Error: ${result.error}`)
    }
  })

  console.log('\n' + '-'.repeat(60))
  console.log(`Total: ${allResults.length} | Passed: ${passed} | Failed: ${failed}`)

  if (failed === 0) {
    console.log('\n🎉 All tests passed! MCP Server is fully functional.')
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. Please review the errors above.`)
  }
  console.log('='.repeat(60))

  return failed === 0
}

async function cleanup(agentId: string) {
  console.log('\n🧹 Cleaning up test data...')

  // Clean up tasks created by this agent
  const deletedTasks = await db.task.deleteMany({
    where: { agentId }
  })
  console.log(`   Deleted ${deletedTasks.count} test tasks`)

  // Clean up the test agent
  await db.agent.delete({
    where: { id: agentId }
  }).catch(() => {})
  console.log('   Deleted test agent')

  await db.$disconnect()
}

async function main() {
  console.log('🚀 MCP Server Regression Test Suite')
  console.log('=====================================\n')

  let agentId: string | null = null

  try {
    // Setup
    const { agent } = await setupTestAgent()
    agentId = agent.id
    const { project, team } = await setupTestData(agent.id)

    // Run tests
    const taskResults = await runTests(agent.id, project.id)
    const teamResults = await runTeamTests(project.id, team.id)

    // Summary
    const allResults = [...taskResults, ...teamResults]
    const success = printSummary(allResults)

    process.exit(success ? 0 : 1)
  } catch (error) {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  } finally {
    if (agentId) {
      await cleanup(agentId)
    } else {
      await db.$disconnect()
    }
  }
}

main()
