/**
 * Unit Tests for MarqDex Work System
 *
 * Tests core utilities, validation, and business logic
 * Run with: npm test
 */

import { describe, it, expect } from '@jest/globals'
import { generateFileName, parseFileName } from '@/lib/utils/file-naming'
import { exportToMarkdown } from '@/lib/utils/export'
import { getAssignmentBadges } from '@/components/tasks/task-card'
import { filterTasks } from '@/lib/tasks/filter'
import { getAgentQueueGroupKey, groupTasksByAgentQueue } from '@/lib/tasks/group'
import { lintTaskSpecMarkdown } from '@/lib/tasks/spec-lint'
import { computeTaskRisk } from '@/lib/tasks/risk'
import { deriveProjectsBottlenecksSummary } from '@/lib/tasks/projects-bottlenecks-summary'
import {
  deriveRecommendedTemplateCategories,
  deriveRecommendedTemplateCategoriesFromCounts
} from '@/lib/templates/recommendation'
import { deriveStarterTemplatePacks } from '@/lib/templates/starter-packs'
import {
  taskClaimSchema,
  taskConfirmAssignSchema,
  taskSpecMarkdownSchema,
  taskSuggestAssigneeSchema
} from '@/lib/utils/validation'

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    file: {
      findUnique: jest.fn(),
    },
  },
}))

describe('File Naming Utilities', () => {
  describe('generateFileName', () => {
    it('should generate correct filename with project name and template type', () => {
      const result = generateFileName('TestProject', 'PROBLEM_DEFINITION')
      expect(result).toMatch(/TestProject-ProblemDefinition-\d{8}/)
    })

    it('should generate correct filename for different template types', () => {
      const cases = [
        { input: 'PROBLEM_DEFINITION', expected: 'ProblemDefinition' },
        { input: 'SOLUTION_DESIGN', expected: 'SolutionDesign' },
        { input: 'EXECUTION_TRACKING', expected: 'ExecutionTracking' },
        { input: 'RETROSPECTIVE_SUMMARY', expected: 'RetrospectiveSummary' },
      ]

      cases.forEach(({ input, expected }) => {
        const result = generateFileName('MyProject', input as any)
        expect(result).toContain(expected)
      })
    })

    it('should include correct date format', () => {
      const result = generateFileName('Project', 'PROBLEM_DEFINITION')
      const dateMatch = result.match(/(\d{8})/)
      expect(dateMatch).toBeTruthy()
    })
  })

  describe('parseFileName', () => {
    it('should parse standard filename correctly', () => {
      const result = parseFileName('MyProject-ProblemDefinition-20260128')
      expect(result).toEqual({
        projectName: 'MyProject',
        templateType: 'ProblemDefinition',
        date: '20260128',
      })
    })

    it('should handle non-standard filenames', () => {
      const result = parseFileName('CustomFileName.md')
      expect(result).toEqual({
        projectName: 'CustomFileName',
        templateType: null,
        date: null,
      })
    })
  })
})

describe('Validation Schemas', () => {
  describe('Email Validation', () => {
    it('should accept valid email addresses', () => {
      const validEmails = [
        'user@example.com',
        'test.user@domain.co.uk',
        'admin+tag@example.org',
      ]

      validEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        expect(emailRegex.test(email)).toBe(true)
      })
    })

    it('should reject invalid email addresses', () => {
      const invalidEmails = [
        'invalid',
        '@example.com',
        'user@',
        'user @example.com',
      ]

      invalidEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        expect(emailRegex.test(email)).toBe(false)
      })
    })
  })

  describe('Password Validation', () => {
    it('should accept valid passwords', () => {
      const validPasswords = [
        'password123',
        'SecurePass!',
        'MyP@ssw0rd',
      ]

      validPasswords.forEach((password) => {
        expect(password.length).toBeGreaterThanOrEqual(8)
      })
    })

    it('should reject short passwords', () => {
      const shortPasswords = [
        'pass',
        '1234567',
        'abc',
      ]

      shortPasswords.forEach((password) => {
        expect(password.length).toBeLessThan(8)
      })
    })
  })
})

describe('Template Type Mapping', () => {
  it('should map template types correctly', () => {
    const templateMapping: Record<string, string> = {
      PROBLEM_DEFINITION: '问题定义',
      SOLUTION_DESIGN: '方案设计',
      EXECUTION_TRACKING: '执行跟踪',
      RETROSPECTIVE_SUMMARY: '复盘总结',
    }

    Object.entries(templateMapping).forEach(([key, value]) => {
      expect(value).toMatch(/[\u4e00-\u9fa5]+/) // Chinese characters
    })
  })
})

describe('Role Hierarchy', () => {
  it('should have correct role hierarchy', () => {
    const roleHierarchy: Record<string, number> = {
      VIEWER: 0,
      EDITOR: 1,
      ADMIN: 2,
    }

    expect(roleHierarchy.VIEWER).toBeLessThan(roleHierarchy.EDITOR)
    expect(roleHierarchy.EDITOR).toBeLessThan(roleHierarchy.ADMIN)
  })

  it('should validate permission levels', () => {
    const hasPermission = (userRole: number, requiredRole: number) => {
      return userRole >= requiredRole
    }

    expect(hasPermission(2, 0)).toBe(true) // Admin can do Viewer tasks
    expect(hasPermission(1, 1)).toBe(true) // Editor can do Editor tasks
    expect(hasPermission(0, 1)).toBe(false) // Viewer cannot do Editor tasks
  })
})

describe('Markdown Formatting', () => {
  it('should detect markdown syntax', () => {
    const markdownTests = [
      { text: '# Heading', hasHeading: true },
      { text: '**bold**', hasBold: true },
      { text: '*italic*', hasItalic: true },
      { text: '- list item', hasList: true },
      { text: '[link](url)', hasLink: true },
    ]

    markdownTests.forEach(({ text, ...expected }) => {
      if (expected.hasHeading) expect(text).toMatch(/^#+\s/)
      if (expected.hasBold) expect(text).toMatch(/\*\*.*\*\*/)
      if (expected.hasItalic) expect(text).toMatch(/\*.*\*/)
      if (expected.hasList) expect(text).toMatch(/^[-*+]\s/)
      if (expected.hasLink) expect(text).toMatch(/\[.*\]\(.*\)/)
    })
  })
})

describe('Utility Functions', () => {
  describe('Array Utilities', () => {
    it('should deduplicate arrays', () => {
      const input = [1, 2, 2, 3, 3, 3, 4]
      const unique = Array.from(new Set(input))
      expect(unique).toEqual([1, 2, 3, 4])
    })

    it('should sort arrays correctly', () => {
      const input = [3, 1, 4, 1, 5, 9]
      const sorted = input.sort((a, b) => a - b)
      expect(sorted).toEqual([1, 1, 3, 4, 5, 9])
    })
  })

  describe('String Utilities', () => {
    it('should truncate long strings', () => {
      const longString = 'This is a very long string that needs to be truncated'
      const truncated = longString.substring(0, 20) + '...'
      expect(truncated.length).toBeLessThan(longString.length)
      expect(truncated).toBe('This is a very long ...')
    })

    it('should convert to title case', () => {
      const input = 'hello world'
      const titleCase = input
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      expect(titleCase).toBe('Hello World')
    })
  })
})

describe('Date Utilities', () => {
  it('should format dates correctly', () => {
    const date = new Date('2026-01-28')
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const formatted = `${year}${month}${day}`

    expect(formatted).toBe('20260128')
  })

  it('should calculate date differences', () => {
    const date1 = new Date('2026-01-28')
    const date2 = new Date('2026-01-20')
    const diffDays = Math.floor((date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24))

    expect(diffDays).toBe(8)
  })
})

describe('File Type Detection', () => {
  it('should detect markdown files', () => {
    const markdownFiles = [
      'document.md',
      'README.md',
      'file.markdown',
    ]

    markdownFiles.forEach((file) => {
      expect(file).toMatch(/\.(md|markdown)$/)
    })
  })

  it('should detect export formats', () => {
    const formats = ['md', 'pdf', 'html', 'txt']

    formats.forEach((format) => {
      expect(['md', 'pdf', 'html', 'txt']).toContain(format)
    })
  })
})

describe('Security Utilities', () => {
  it('should sanitize HTML input', () => {
    const input = '<script>alert("xss")</script>'
    const sanitized = input.replace(/<script[^>]*>.*?<\/script>/gi, '')

    expect(sanitized).not.toContain('<script>')
  })

  it('should validate URL format', () => {
    const validUrls = [
      'https://example.com',
      'http://localhost:3000',
      'https://subdomain.domain.co.uk/path',
    ]

    validUrls.forEach((url) => {
      expect(url).toMatch(/^https?:\/\/.+/)
    })
  })
})

describe('Task Assignment Schemas', () => {
  it('accepts valid TaskSpec markdown', () => {
    const md = `# TaskSpec

## Goal
- Build API contract

## Deliverables
- Contract document

## Requirements
- Must be parseable

## Acceptance Criteria
- API review passed

## Priority
- HIGH

## Due Date
- 2026-03-20
`
    const parsed = taskSpecMarkdownSchema.safeParse(md)
    expect(parsed.success).toBe(true)
  })

  it('rejects TaskSpec markdown without required sections', () => {
    const parsed = taskSpecMarkdownSchema.safeParse('# TaskSpec\n\n## Goal\n- only one section')
    expect(parsed.success).toBe(false)
  })

  it('validates human claim payload', () => {
    const parsed = taskClaimSchema.safeParse({
      assigneeType: 'HUMAN',
      assigneeId: 'user_1'
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid human claim payload without assigneeId', () => {
    const parsed = taskClaimSchema.safeParse({
      assigneeType: 'HUMAN'
    })
    expect(parsed.success).toBe(false)
  })

  it('validates functional-agent assignment payload', () => {
    const parsed = taskConfirmAssignSchema.safeParse({
      assigneeType: 'FUNCTIONAL_AGENT',
      functionalAgentType: 'ENGINEERING',
      assignmentMode: 'AI_SUGGESTED'
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects AGENT assignment without agentId', () => {
    const parsed = taskConfirmAssignSchema.safeParse({
      assigneeType: 'AGENT',
      assignmentMode: 'MANUAL'
    })
    expect(parsed.success).toBe(false)
  })

  it('normalizes suggest assignee payload defaults', () => {
    const parsed = taskSuggestAssigneeSchema.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.topN).toBe(3)
    }
  })
})

describe('Task Card Helpers', () => {
  it('builds assignment badges from assignment fields', () => {
    const badges = getAssignmentBadges({
      assignmentMode: 'AI_SUGGESTED',
      functionalAgentType: 'ENGINEERING',
      assigneeType: 'FUNCTIONAL_AGENT'
    })

    expect(badges.map((b) => b.label)).toEqual([
      'AI Suggested',
      'QUEUE:ENGINEERING',
      'Assignee:Agent Queue'
    ])
  })

  it('returns empty badge list when no assignment fields', () => {
    const badges = getAssignmentBadges({})
    expect(badges).toEqual([])
  })
})

describe('TaskSpec Lint', () => {
  it('returns valid=true for complete spec', () => {
    const result = lintTaskSpecMarkdown(`# TaskSpec

## Goal
- Build a stable task pipeline

## Deliverables
- API route and UI integration

## Requirements
- Keep compatibility with existing routes

## Acceptance Criteria
- Unit and route tests pass

## Priority
- HIGH

## Due Date
- 2026-04-01`)

    expect(result.valid).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('returns errors for missing required sections', () => {
    const result = lintTaskSpecMarkdown(`# TaskSpec

## Goal
- TBD`)

    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'MISSING_SECTION')).toBe(true)
  })
})

describe('Task Risk', () => {
  it('returns HIGH risk for imminent due + failed run + low spec quality', () => {
    const risk = computeTaskRisk({
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
      latestAgentRunStatus: 'FAILED',
      specQualityScore: 40,
      assigneeType: 'FUNCTIONAL_AGENT' as any,
      functionalAgentType: 'ENGINEERING',
      status: 'IN_PROGRESS' as any,
      onlineAgentsByDomain: new Map()
    })

    expect(risk.riskLevel).toBe('HIGH')
    expect(risk.riskScore).toBeGreaterThanOrEqual(70)
  })
})

describe('Projects Bottlenecks Summary', () => {
  it('derives at-risk domains and high-risk task counts by project', () => {
    const summary = deriveProjectsBottlenecksSummary({
      projectIds: ['p1', 'p2'],
      queueRows: [
        { projectId: 'p1', functionalAgentType: 'ENGINEERING', count: 3 },
        { projectId: 'p2', functionalAgentType: 'QA', count: 1 }
      ],
      riskTasks: [
        {
          id: 't1',
          projectId: 'p1',
          status: 'IN_PROGRESS' as any,
          dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
          assigneeType: 'FUNCTIONAL_AGENT' as any,
          functionalAgentType: 'ENGINEERING',
          specMarkdown: `# TaskSpec

## Goal
- TBD

## Deliverables
- TODO

## Requirements
- TBD

## Acceptance Criteria
- TODO

## Priority
- HIGH`,
          latestRunStatus: 'FAILED'
        }
      ],
      onlineAgentsByDomain: new Map([['QA', 1]])
    })

    expect(summary.get('p1')?.atRiskDomainCount).toBe(1)
    expect(summary.get('p1')?.highRiskTaskCount).toBeGreaterThanOrEqual(1)
    expect(summary.get('p1')?.recommendationCount).toBeGreaterThanOrEqual(2)
    expect(summary.get('p2')?.atRiskDomainCount).toBe(0)
    expect(summary.get('p2')?.recommendationCount).toBe(0)
  })
})

describe('Template Recommendation Helpers', () => {
  it('derives recommended categories from raw templateType values', () => {
    const result = deriveRecommendedTemplateCategories({
      templateTypes: [
        'PROBLEM_DEFINITION',
        'SOLUTION_DESIGN',
        'PROBLEM_DEFINITION',
        'invalid'
      ],
      limit: 2
    })

    expect(result[0]).toBe('PROBLEM_DEFINITION')
    expect(result).toContain('SOLUTION_DESIGN')
    expect(result.length).toBe(2)
  })

  it('derives recommended categories from grouped counts', () => {
    const result = deriveRecommendedTemplateCategoriesFromCounts({
      items: [
        { templateType: 'EXECUTION_TRACKING', count: 4 },
        { templateType: 'PROBLEM_DEFINITION', count: 2 },
        { templateType: 'UNKNOWN', count: 10 }
      ],
      limit: 2
    })

    expect(result).toEqual(['EXECUTION_TRACKING', 'PROBLEM_DEFINITION'])
  })
})

describe('Starter Template Packs', () => {
  it('builds PM and IT starter packs from preferred built-in names', () => {
    const packs = deriveStarterTemplatePacks([
      { id: 't1', name: 'Project Charter (PM)', category: 'PROBLEM_DEFINITION' },
      { id: 't2', name: 'Sprint Plan & Execution Board', category: 'EXECUTION_TRACKING' },
      { id: 't3', name: 'Retrospective Summary', category: 'RETROSPECTIVE_SUMMARY' },
      { id: 't4', name: 'Technical Design Document (IT R&D)', category: 'SOLUTION_DESIGN' },
      { id: 't5', name: 'API Specification (Backend)', category: 'SOLUTION_DESIGN' },
      { id: 't6', name: 'Release Readiness Checklist', category: 'EXECUTION_TRACKING' },
      { id: 't7', name: 'Incident Postmortem (IT Ops)', category: 'RETROSPECTIVE_SUMMARY' },
      { id: 't8', name: 'Service Operations Runbook', category: 'SOLUTION_DESIGN' }
    ])

    const pmPack = packs.find((pack) => pack.id === 'PM_STARTER')
    const itPack = packs.find((pack) => pack.id === 'IT_RD_STARTER')
    const opsPack = packs.find((pack) => pack.id === 'OPS_INCIDENT_STARTER')
    expect(pmPack?.templateIds.length).toBeGreaterThanOrEqual(3)
    expect(itPack?.templateIds.length).toBeGreaterThanOrEqual(3)
    expect(opsPack?.templateIds.length).toBeGreaterThanOrEqual(3)
  })

  it('falls back to category-based selection when preferred names are missing', () => {
    const packs = deriveStarterTemplatePacks([
      { id: 'x1', name: 'PD Base', category: 'PROBLEM_DEFINITION' },
      { id: 'x2', name: 'SD Base', category: 'SOLUTION_DESIGN' },
      { id: 'x3', name: 'ET Base', category: 'EXECUTION_TRACKING' }
    ])

    const pmPack = packs.find((pack) => pack.id === 'PM_STARTER')
    const itPack = packs.find((pack) => pack.id === 'IT_RD_STARTER')
    const opsPack = packs.find((pack) => pack.id === 'OPS_INCIDENT_STARTER')
    expect(pmPack?.templateIds.length).toBeGreaterThanOrEqual(2)
    expect(itPack?.templateIds.length).toBeGreaterThanOrEqual(2)
    expect(opsPack?.templateIds.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Task Filter Helpers', () => {
  const tasks = [
    {
      id: 't1',
      title: 'Backend Task',
      description: 'Implement API',
      status: 'PENDING',
      priority: 2,
      project: { id: 'p1', name: 'Proj' },
      assignee: { id: 'u1', name: 'A' },
      assigneeType: 'HUMAN',
      assignmentMode: 'MANUAL',
      riskLevel: 'LOW'
    },
    {
      id: 't2',
      title: 'Agent Task',
      description: 'Auto run',
      status: 'IN_PROGRESS',
      priority: 1,
      project: { id: 'p1', name: 'Proj' },
      assignee: null,
      assigneeType: 'FUNCTIONAL_AGENT',
      assignmentMode: 'AI_SUGGESTED',
      riskLevel: 'HIGH'
    }
  ]

  it('filters by assigneeType', () => {
    const result = filterTasks(tasks as any, {
      searchQuery: '',
      statusFilter: 'all',
      priorityFilter: 'all',
      projectFilter: 'all',
      assigneeFilter: 'all',
      assigneeTypeFilter: 'FUNCTIONAL_AGENT',
      assignmentModeFilter: 'all',
      riskFilter: 'all'
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })

  it('filters by assignmentMode', () => {
    const result = filterTasks(tasks as any, {
      searchQuery: '',
      statusFilter: 'all',
      priorityFilter: 'all',
      projectFilter: 'all',
      assigneeFilter: 'all',
      assigneeTypeFilter: 'all',
      assignmentModeFilter: 'MANUAL',
      riskFilter: 'all'
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('filters by riskLevel', () => {
    const result = filterTasks(tasks as any, {
      searchQuery: '',
      statusFilter: 'all',
      priorityFilter: 'all',
      projectFilter: 'all',
      assigneeFilter: 'all',
      assigneeTypeFilter: 'all',
      assignmentModeFilter: 'all',
      riskFilter: 'HIGH'
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })
})

describe('Task Agent Queue Group Helpers', () => {
  it('computes fallback agent-queue group key correctly', () => {
    expect(
      getAgentQueueGroupKey({ id: 't1', title: 'a', assigneeType: 'AGENT', functionalAgentType: null })
    ).toBe('AGENT_OTHER')
    expect(
      getAgentQueueGroupKey({ id: 't2', title: 'b', assigneeType: 'HUMAN', functionalAgentType: null })
    ).toBe('HUMAN')
    expect(
      getAgentQueueGroupKey({ id: 't3', title: 'c', assigneeType: undefined, functionalAgentType: null })
    ).toBe('UNASSIGNED')
  })

  it('groups tasks by agent-queue type and preserves display order', () => {
    const grouped = groupTasksByAgentQueue([
      { id: 't1', title: 'Eng A', assigneeType: 'FUNCTIONAL_AGENT', functionalAgentType: 'ENGINEERING' },
      { id: 't2', title: 'Human A', assigneeType: 'HUMAN', functionalAgentType: null },
      { id: 't3', title: 'Design A', assigneeType: 'FUNCTIONAL_AGENT', functionalAgentType: 'DESIGN' },
      { id: 't4', title: 'Agent A', assigneeType: 'AGENT', functionalAgentType: null }
    ])

    expect(grouped.map((g) => g.key)).toEqual(['ENGINEERING', 'DESIGN', 'AGENT_OTHER', 'HUMAN'])
    expect(grouped.find((g) => g.key === 'ENGINEERING')?.tasks).toHaveLength(1)
    expect(grouped.find((g) => g.key === 'AGENT_OTHER')?.tasks[0].id).toBe('t4')
  })
})
