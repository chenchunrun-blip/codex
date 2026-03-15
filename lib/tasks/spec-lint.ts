export type TaskSpecLintIssue = {
  level: "error" | "warning"
  code: string
  message: string
  section?: string
}

export type TaskSpecLintResult = {
  valid: boolean
  score: number
  issues: TaskSpecLintIssue[]
  sectionStats: Array<{
    section: string
    bullets: number
  }>
}

const REQUIRED_SECTIONS = ["Goal", "Deliverables", "Requirements", "Acceptance Criteria"] as const

const PLACEHOLDER_PATTERNS = [/to be filled/i, /^tbd$/i, /^todo$/i, /^n\/a$/i, /^pending$/i]

function extractSectionBlock(markdown: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i")
  const match = markdown.match(regex)
  return match?.[1] || ""
}

function extractBulletItems(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim()
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function lintTaskSpecMarkdown(markdown: string): TaskSpecLintResult {
  const issues: TaskSpecLintIssue[] = []
  const sectionStats: Array<{ section: string; bullets: number }> = []

  for (const section of REQUIRED_SECTIONS) {
    const block = extractSectionBlock(markdown, section)
    if (!block) {
      issues.push({
        level: "error",
        code: "MISSING_SECTION",
        message: `Missing section: ${section}`,
        section
      })
      sectionStats.push({ section, bullets: 0 })
      continue
    }

    const bullets = extractBulletItems(block)
    sectionStats.push({ section, bullets: bullets.length })
    if (bullets.length === 0) {
      issues.push({
        level: "error",
        code: "EMPTY_SECTION",
        message: `Section ${section} must contain bullet items`,
        section
      })
      continue
    }

    for (const bullet of bullets) {
      if (isPlaceholder(bullet)) {
        issues.push({
          level: "warning",
          code: "PLACEHOLDER_CONTENT",
          message: `Section ${section} contains placeholder item: "${bullet}"`,
          section
        })
      } else if (bullet.length < 8) {
        issues.push({
          level: "warning",
          code: "SHORT_CONTENT",
          message: `Section ${section} has a very short item: "${bullet}"`,
          section
        })
      }
    }
  }

  const dueDateBlock = extractSectionBlock(markdown, "Due Date")
  if (!dueDateBlock) {
    issues.push({
      level: "warning",
      code: "MISSING_DUE_DATE",
      message: "Due Date section is recommended"
    })
  } else {
    const dueItems = extractBulletItems(dueDateBlock)
    const firstDue = dueItems[0]
    if (!firstDue || isPlaceholder(firstDue)) {
      issues.push({
        level: "warning",
        code: "UNSPECIFIED_DUE_DATE",
        message: "Due Date should be a concrete date"
      })
    } else if (Number.isNaN(Date.parse(firstDue))) {
      issues.push({
        level: "warning",
        code: "INVALID_DUE_DATE",
        message: "Due Date is not a valid date string"
      })
    }
  }

  const errorCount = issues.filter((issue) => issue.level === "error").length
  const warningCount = issues.filter((issue) => issue.level === "warning").length
  const score = Math.max(0, 100 - errorCount * 25 - warningCount * 8)

  return {
    valid: errorCount === 0,
    score,
    issues,
    sectionStats
  }
}
