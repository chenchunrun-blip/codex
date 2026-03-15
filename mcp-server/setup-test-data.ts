/**
 * Setup test data for MCP team tools testing
 */

import { db } from '../lib/db'

async function setupTestData() {
  console.log('🔧 Setting up test data...\n')

  // Get or create a user
  let user = await db.user.findFirst()
  if (!user) {
    user = await db.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
        password: 'hashedpassword123'
      }
    })
    console.log('✅ Created user:', user.id)
  } else {
    console.log('✅ Found existing user:', user.id)
  }

  // Get or create a team
  let team = await db.team.findFirst()
  if (!team) {
    team = await db.team.create({
      data: {
        name: 'Engineering Team',
        description: 'The main engineering team for product development',
        creatorId: user.id
      }
    })
    console.log('✅ Created team:', team.name, '(', team.id, ')')
  } else {
    console.log('✅ Found existing team:', team.name, '(', team.id, ')')
  }

  // Add user as team member
  const existingMember = await db.teamMember.findFirst({
    where: { teamId: team.id, userId: user.id }
  })
  if (!existingMember) {
    await db.teamMember.create({
      data: {
        teamId: team.id,
        userId: user.id,
        role: 'ADMIN'
      }
    })
    console.log('✅ Added user to team as ADMIN')
  }

  // Create another team member
  const memberCount = await db.teamMember.count({ where: { teamId: team.id } })
  if (memberCount < 2) {
    let user2 = await db.user.findFirst({
      where: { id: { not: user.id } }
    })
    if (!user2) {
      user2 = await db.user.create({
        data: {
          email: 'member2@example.com',
          name: 'Team Member',
          password: 'hashedpassword123'
        }
      })
    }
    await db.teamMember.create({
      data: {
        teamId: team.id,
        userId: user2.id,
        role: 'MEMBER'
      }
    })
    console.log('✅ Added second team member')
  }

  // Create a project
  let project = await db.project.findFirst()
  if (!project) {
    project = await db.project.create({
      data: {
        name: 'Website Redesign',
        description: 'Redesign the company website with modern UI/UX',
        teamId: team.id,
        creatorId: user.id,
        status: 'ACTIVE'
      }
    })
    console.log('✅ Created project:', project.name, '(', project.id, ')')
  } else {
    console.log('✅ Found existing project:', project.name, '(', project.id, ')')
  }

  // Get or create an AI agent
  let agent = await db.agent.findFirst()
  if (!agent) {
    const { encrypt } = await import('../lib/utils/encryption')
    agent = await db.agent.create({
      data: {
        name: 'ai-assistant-1',
        displayName: 'AI Assistant',
        description: 'An AI assistant for code review and documentation',
        type: 'AI',
        capabilities: ['code-review', 'documentation', 'testing'],
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true
      }
    })
    console.log('✅ Created AI agent:', agent.name, '(', agent.id, ')')
  } else {
    console.log('✅ Found existing agent:', agent.name, '(', agent.id, ')')
  }

  // Create tasks with different assignments
  const existingTasks = await db.task.count({ where: { projectId: project.id } })
  if (existingTasks === 0) {
    // Task 1: Assigned to human user
    await db.task.create({
      data: {
        title: 'Design Homepage Mockups',
        description: 'Create Figma mockups for the new homepage',
        projectId: project.id,
        creatorId: user.id,
        assigneeId: user.id,
        assigneeType: 'HUMAN',
        status: 'IN_PROGRESS',
        priority: 2,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    })
    console.log('✅ Created task 1: Design Homepage Mockups (assigned to human)')

    // Task 2: Assigned to AI agent
    await db.task.create({
      data: {
        title: 'Generate Documentation',
        description: 'Generate API documentation from code comments',
        projectId: project.id,
        creatorId: user.id,
        agentId: agent.id,
        assigneeType: 'AGENT',
        status: 'PENDING',
        priority: 1
      }
    })
    console.log('✅ Created task 2: Generate Documentation (assigned to AI agent)')

    // Task 3: Unassigned
    await db.task.create({
      data: {
        title: 'Setup CI/CD Pipeline',
        description: 'Configure GitHub Actions for automated deployment',
        projectId: project.id,
        creatorId: user.id,
        assigneeType: 'HUMAN',
        status: 'PENDING',
        priority: 3
      }
    })
    console.log('✅ Created task 3: Setup CI/CD Pipeline (unassigned)')

    // Task 4: Assigned to AI agent, completed
    const completedTask = await db.task.create({
      data: {
        title: 'Review Code Quality',
        description: 'Analyze codebase and suggest improvements',
        projectId: project.id,
        creatorId: user.id,
        agentId: agent.id,
        assigneeType: 'AGENT',
        status: 'COMPLETED',
        priority: 2,
        startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        completedAt: new Date()
      }
    })
    console.log('✅ Created task 4: Review Code Quality (completed by AI)')

    // Add a deliverable to the completed task
    await db.deliverable.create({
      data: {
        taskId: completedTask.id,
        name: 'Code Quality Report',
        type: 'report',
        content: '# Code Quality Report\n\n## Findings\n- Reduced complexity in utils.ts\n- Improved test coverage to 85%\n- Fixed 12 linting issues',
        status: 'APPROVED',
        submittedAt: new Date()
      }
    })
    console.log('✅ Added deliverable to completed task')
  } else {
    console.log(`✅ Found ${existingTasks} existing tasks`)
  }

  console.log('\n📊 Test Data Summary:')
  console.log('   Team:', team.name)
  console.log('   Project:', project.name)
  console.log('   Members:', await db.teamMember.count({ where: { teamId: team.id } }))
  console.log('   Tasks:', await db.task.count({ where: { projectId: project.id } }))

  const stats = await db.task.groupBy({
    by: ['status'],
    where: { projectId: project.id },
    _count: { status: true }
  })
  console.log('   Task Status Breakdown:')
  stats.forEach(s => {
    console.log(`     - ${s.status}: ${s._count.status}`)
  })

  console.log('\n📝 Use these IDs for MCP tool testing:')
  console.log('   Team ID:', team.id)
  console.log('   Project ID:', project.id)
  console.log('   Agent ID:', agent.id)

  await db.$disconnect()
}

setupTestData().catch(e => {
  console.error('❌ Error:', e)
  process.exit(1)
})
