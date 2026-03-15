type BuildSpecInput = {
  fileId: string
  fileName: string
  fileContent: string
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim()
}

function toBulletLines(lines: string[], max: number): string[] {
  const result: string[] = []
  for (const raw of lines) {
    const clean = normalizeLine(raw.replace(/^[-*]\s+/, ""))
    if (!clean) continue
    result.push(`- ${clean}`)
    if (result.length >= max) break
  }
  return result
}

function extractHeadingBlock(content: string, headingKeyword: string): string[] {
  const lines = content.split(/\r?\n/)
  const lowerKeyword = headingKeyword.toLowerCase()
  const start = lines.findIndex((line) => {
    const trimmed = line.trim().toLowerCase()
    return /^#{1,6}\s+/.test(trimmed) && trimmed.includes(lowerKeyword)
  })
  if (start === -1) return []

  const bucket: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (/^#{1,6}\s+/.test(line)) break
    if (!line) continue
    if (/^[-*]\s+/.test(line)) {
      bucket.push(line)
    } else if (!line.startsWith("```")) {
      bucket.push(`- ${line}`)
    }
  }
  return bucket
}

function extractFallbackBullets(content: string, max: number): string[] {
  const lines = content.split(/\r?\n/)
  const bulletCandidates = lines
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
  if (bulletCandidates.length > 0) {
    return toBulletLines(bulletCandidates, max)
  }

  const plainLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s+/.test(line))
    .slice(0, max)
  return toBulletLines(plainLines.map((line) => `- ${line}`), max)
}

function extractTitle(content: string, fileName: string): string {
  const lines = content.split(/\r?\n/)
  const heading = lines.find((line) => /^#\s+/.test(line.trim()))
  if (heading) {
    return normalizeLine(heading.replace(/^#\s+/, ""))
  }
  return fileName.replace(/\.md$/i, "")
}

export function buildTaskSpecFromFile(input: BuildSpecInput): string {
  const title = extractTitle(input.fileContent, input.fileName)
  const goals = toBulletLines(
    extractHeadingBlock(input.fileContent, "goal").concat(extractHeadingBlock(input.fileContent, "objective")),
    3
  )
  const deliverables = toBulletLines(
    extractHeadingBlock(input.fileContent, "deliverable").concat(extractHeadingBlock(input.fileContent, "output")),
    5
  )
  const requirements = toBulletLines(
    extractHeadingBlock(input.fileContent, "requirement").concat(extractHeadingBlock(input.fileContent, "constraint")),
    6
  )
  const acceptance = toBulletLines(
    extractHeadingBlock(input.fileContent, "acceptance").concat(extractHeadingBlock(input.fileContent, "criteria")),
    5
  )

  const fallback = extractFallbackBullets(input.fileContent, 6)

  const goalLines = goals.length > 0 ? goals : [`- Deliver the documented objective for ${title}`]
  const deliverableLines =
    deliverables.length > 0
      ? deliverables
      : fallback.slice(0, 3).length > 0
        ? fallback.slice(0, 3)
        : ["- A complete markdown deliverable that can be reviewed"]
  const requirementLines =
    requirements.length > 0
      ? requirements
      : fallback.slice(0, 4).length > 0
        ? fallback.slice(0, 4)
        : ["- Keep implementation aligned with the source markdown details"]
  const acceptanceLines =
    acceptance.length > 0
      ? acceptance
      : ["- Deliverables are reviewed and approved by a human reviewer"]

  return `# TaskSpec

## Source File
- File: [${input.fileName}](/editor/${input.fileId})
- File ID: ${input.fileId}

## Goal
${goalLines.join("\n")}

## Deliverables
${deliverableLines.join("\n")}

## Requirements
${requirementLines.join("\n")}

## Acceptance Criteria
${acceptanceLines.join("\n")}

## Priority
- MEDIUM`
}

