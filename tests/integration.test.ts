/**
 * Comprehensive Test Suite for MarqDex Work System
 *
 * This file contains integration tests for all major features.
 * Run with: npm test
 *
 * NOTE: These tests require a running database and server.
 * They will be skipped if DATABASE_URL is not configured.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'

// Check if database is configured and integration mode is explicitly enabled.
const hasDatabase = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1'

// Only import Prisma if database is configured
let prisma: any = null
if (hasDatabase) {
  try {
    const { PrismaClient } = require('@prisma/client')
    prisma = new PrismaClient()
  } catch {
    // Prisma not available
  }
}

// Skip all tests unless explicitly enabled to avoid false failures in unit-test environments.
const describeIntegration = hasDatabase && runIntegration ? describe : describe.skip

describeIntegration('Authentication System', () => {
  describe('User Registration', () => {
    it('should register a new user with valid credentials', async () => {
      const response = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'testpassword123',
          name: 'Test User'
        })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.user).toHaveProperty('id')
      expect(data.user.email).toBe('test@example.com')
    })

    it('should reject duplicate email registration', async () => {
      const response = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'testpassword123',
          name: 'Test User'
        })
      })

      expect(response.status).toBe(400)
    })
  })

  describe('User Login', () => {
    it('should login with valid credentials', async () => {
      const response = await fetch('http://localhost:3000/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'testpassword123'
        })
      })

      expect(response.status).toBe(200)
    })
  })
})

describeIntegration('Team Management', () => {
  let authToken: string
  let teamId: string

  beforeAll(async () => {
    // Login and get auth token
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken
  })

  it('should create a new team', async () => {
    const response = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Team',
        description: 'A test team for integration testing'
      })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    teamId = data.id
    expect(data.name).toBe('Test Team')
    expect(data.members).toHaveLength(1)
  })

  it('should list user teams', async () => {
    const response = await fetch('http://localhost:3000/api/teams', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})

describeIntegration('Project Management', () => {
  let authToken: string
  let teamId: string
  let projectId: string

  beforeAll(async () => {
    // Setup
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken

    // Create team
    const teamResponse = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name: 'Test Team' })
    })
    const teamData = await teamResponse.json()
    teamId = teamData.id
  })

  it('should create a new project', async () => {
    const response = await fetch('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Project',
        teamId: teamId,
        description: 'A test project'
      })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    projectId = data.id
    expect(data.name).toBe('Test Project')
  })
})

describeIntegration('File Management', () => {
  let authToken: string
  let teamId: string
  let projectId: string
  let fileId: string

  beforeAll(async () => {
    // Complete setup
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken

    const teamResponse = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name: 'Test Team' })
    })
    const teamData = await teamResponse.json()
    teamId = teamData.id

    const projectResponse = await fetch('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Project',
        teamId: teamId
      })
    })
    const projectData = await projectResponse.json()
    projectId = projectData.id
  })

  it('should create a new file', async () => {
    const response = await fetch('http://localhost:3000/api/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        projectId: projectId,
        content: '# Test File\n\nThis is a test file.'
      })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    fileId = data.id
    expect(data.content).toBe('# Test File\n\nThis is a test file.')
  })

  it('should update file content', async () => {
    const response = await fetch(`http://localhost:3000/api/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        content: '# Updated Test File\n\nThis is updated content.'
      })
    })

    expect(response.status).toBe(200)
  })

  it('should get file details', async () => {
    const response = await fetch(`http://localhost:3000/api/files/${fileId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('content')
  })
})

describeIntegration('Template System', () => {
  let authToken: string

  beforeAll(async () => {
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken
  })

  it('should list all templates', async () => {
    const response = await fetch('http://localhost:3000/api/templates', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })

  it('should include built-in templates', async () => {
    const response = await fetch('http://localhost:3000/api/templates', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    const data = await response.json()
    const builtInTemplates = data.filter((t: any) => t.isBuiltIn)
    expect(builtInTemplates.length).toBeGreaterThanOrEqual(4)
  })
})

describeIntegration('Version Control', () => {
  let authToken: string
  let teamId: string
  let projectId: string
  let fileId: string

  beforeAll(async () => {
    // Setup complete environment
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken

    const teamResponse = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name: 'Test Team' })
    })
    const teamData = await teamResponse.json()
    teamId = teamData.id

    const projectResponse = await fetch('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Project',
        teamId: teamId
      })
    })
    const projectData = await projectResponse.json()
    projectId = projectData.id

    const fileResponse = await fetch('http://localhost:3000/api/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        projectId: projectId,
        content: '# Initial Version'
      })
    })
    const fileData = await fileResponse.json()
    fileId = fileData.id
  })

  it('should create a version', async () => {
    const response = await fetch('http://localhost:3000/api/versions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        fileId: fileId,
        content: '# Version 2',
        changeLog: 'Updated content'
      })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.versionNumber).toBe(1)
  })

  it('should list file versions', async () => {
    const response = await fetch(`http://localhost:3000/api/versions?fileId=${fileId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})

describeIntegration('AI Integration', () => {
  let authToken: string

  beforeAll(async () => {
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken
  })

  it('should require API key for generation', async () => {
    const response = await fetch('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        templateType: 'PROBLEM_DEFINITION',
        projectName: 'Test Project'
      })
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('API key')
  })
})

describeIntegration('Comments System', () => {
  let authToken: string
  let teamId: string
  let projectId: string
  let fileId: string

  beforeAll(async () => {
    // Setup
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken

    const teamResponse = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name: 'Test Team' })
    })
    const teamData = await teamResponse.json()
    teamId = teamData.id

    const projectResponse = await fetch('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Project',
        teamId: teamId
      })
    })
    const projectData = await projectResponse.json()
    projectId = projectData.id

    const fileResponse = await fetch('http://localhost:3000/api/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        projectId: projectId,
        content: '# Test File'
      })
    })
    const fileData = await fileResponse.json()
    fileId = fileData.id
  })

  it('should create a comment', async () => {
    const response = await fetch('http://localhost:3000/api/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        fileId: fileId,
        content: 'This is a test comment'
      })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.content).toBe('This is a test comment')
  })

  it('should list file comments', async () => {
    const response = await fetch(`http://localhost:3000/api/comments?fileId=${fileId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })
})

describeIntegration('Export Functionality', () => {
  let authToken: string
  let teamId: string
  let projectId: string
  let fileId: string

  beforeAll(async () => {
    // Setup
    const loginResponse = await fetch('http://localhost:3000/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    })
    const loginData = await loginResponse.json()
    authToken = loginData.sessionToken

    const teamResponse = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ name: 'Test Team' })
    })
    const teamData = await teamResponse.json()
    teamId = teamData.id

    const projectResponse = await fetch('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Test Project',
        teamId: teamId
      })
    })
    const projectData = await projectResponse.json()
    projectId = projectData.id

    const fileResponse = await fetch('http://localhost:3000/api/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        projectId: projectId,
        content: '# Test File\n\nContent to export'
      })
    })
    const fileData = await fileResponse.json()
    fileId = fileData.id
  })

  it('should export file as Markdown', async () => {
    const response = await fetch(`http://localhost:3000/api/files/${fileId}/export?format=md`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
  })

  it('should export file as PDF', async () => {
    const response = await fetch(`http://localhost:3000/api/files/${fileId}/export?format=pdf`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
  })
})

describeIntegration('Access Control', () => {
  it('should prevent unauthorized file access', async () => {
    const response = await fetch('http://localhost:3000/api/files/some-random-id')

    expect(response.status).toBe(401)
  })

  it('should prevent unauthorized team operations', async () => {
    const response = await fetch('http://localhost:3000/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unauthorized Team'
      })
    })

    expect(response.status).toBe(401)
  })
})

// Cleanup
afterAll(async () => {
  // Clean up test data
  if (prisma) {
    await prisma.user.deleteMany({
      where: { email: 'test@example.com' }
    })
    await prisma.$disconnect()
  }
})
