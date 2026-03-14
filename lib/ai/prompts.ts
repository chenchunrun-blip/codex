import { TemplateCategory } from "@prisma/client"

export const TEMPLATE_PROMPTS: Record<TemplateCategory, (projectName: string, context?: string) => string> = {
  PROBLEM_DEFINITION: (projectName: string, context?: string) =>
    `Generate a comprehensive problem definition document for a project called "${projectName}".

${context ? `Context: ${context}` : ""}

Please output pure Markdown with the following sections:
- Background
- Problem Statement
- Impact
- Goals
- Constraints
- Success Criteria`,

  SOLUTION_DESIGN: (projectName: string, context?: string) =>
    `Generate a detailed solution design document for project "${projectName}".

${context ? `Context: ${context}` : ""}

Please output pure Markdown with:
- Solution Overview
- Architecture
- Components
- Data Flow
- Implementation Phases
- Risks and Mitigations`,

  EXECUTION_TRACKING: (projectName: string, context?: string) =>
    `Generate an execution tracking template for project "${projectName}".

${context ? `Tasks: ${context}` : ""}

Please output pure Markdown with:
- Task table (Task, Status, Assignee, Due Date, Priority)
- Progress tracking sections
- Blockers and issues log
- Next steps`,

  RETROSPECTIVE_SUMMARY: (projectName: string, context?: string) =>
    `Generate a retrospective summary for completed project "${projectName}".

${context ? `Outcomes: ${context}` : ""}

Please output pure Markdown with:
- What Went Well
- What Could Be Improved
- Lessons Learned
- Action Items for Future Projects
- Team Feedback Summary`,

  CUSTOM: (projectName: string, context?: string) =>
    `Generate a custom document for project "${projectName}".

${context ? `Details: ${context}` : ""}

Please output pure Markdown with appropriate sections for this custom template.`
}

export function generateBatchPrompt(
  projectFiles: Array<{ name: string; type: string; content: string }>
): string {
  const filesContent = projectFiles
    .map(f => `## ${f.name}\n\n${f.content}`)
    .join("\n\n---\n\n")

  return `Analyze the following project files and provide:

1. Executive Summary
2. Key Insights
3. Recommendations
4. Next Steps

Project Files:
${filesContent}

Please output pure Markdown.`
}

export function generateOptimizationPrompt(
  content: string,
  instruction: string
): string {
  return `Please optimize the following Markdown content according to this instruction: ${instruction}

Original Content:
${content}

Please output the optimized version in pure Markdown format.`
}
