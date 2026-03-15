import { z } from "zod"

// Password strength validation
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required")
})

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
  name: z.string().min(2, "Name must be at least 2 characters"),
  nickname: z.string().optional()
})

export const teamCreateSchema = z.object({
  name: z.string().min(2, "Team name must be at least 2 characters"),
  description: z.string().optional()
})

export const projectCreateSchema = z.object({
  name: z.string().min(2, "Project name must be at least 2 characters"),
  description: z.string().optional(),
  teamId: z.string().min(1, "Team ID is required"),
  starterTemplateIds: z.array(z.string().min(1)).max(12).optional().default([])
})

export const fileCreateSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  templateId: z.string().optional(),
  name: z.string().optional(),
  content: z.string().default("")
})

export const templateCreateSchema = z.object({
  name: z.string().min(2, "Template name must be at least 2 characters"),
  description: z.string().optional(),
  category: z.enum([
    "PROBLEM_DEFINITION",
    "SOLUTION_DESIGN",
    "EXECUTION_TRACKING",
    "RETROSPECTIVE_SUMMARY",
    "CUSTOM"
  ]),
  content: z.string().min(1, "Template content is required"),
  aiPrompt: z.string().optional()
})

export const commentCreateSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string().min(1, "Comment content is required"),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  parentId: z.string().optional()
})

// Task Management Schemas
const priorityMap: Record<string, number> = {
  "LOW": 0,
  "MEDIUM": 1,
  "HIGH": 2,
  "URGENT": 3
}

const prioritySchema = z.union([
  z.number().min(0).max(3),
  z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).transform(val => priorityMap[val])
]).default(1)

const taskSpecRequiredSections = [
  "Goal",
  "Deliverables",
  "Requirements",
  "Acceptance Criteria"
] as const

const taskSpecPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"])

export const taskSpecMarkdownSchema = z.string()
  .min(1, "TaskSpec markdown is required")
  .superRefine((markdown, ctx) => {
    for (const section of taskSpecRequiredSections) {
      // Require markdown heading with section name.
      const sectionRegex = new RegExp(`^##\\s+${section}\\s*$`, "mi")
      if (!sectionRegex.test(markdown)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `TaskSpec missing required section: ${section}`
        })
      }
    }

    const priorityRegex = /^##\s+Priority\s*$[\s\S]*?^-\s*(HIGH|MEDIUM|LOW)\s*$/mi
    if (!priorityRegex.test(markdown)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TaskSpec Priority must be one of: HIGH, MEDIUM, LOW"
      })
    }

    // Optional due date validation if Due Date section exists.
    const dueDateMatch = markdown.match(/^##\s+Due Date\s*$[\s\S]*?^-\s*(.+)\s*$/mi)
    if (dueDateMatch?.[1]) {
      const dueDate = dueDateMatch[1].trim()
      if (Number.isNaN(Date.parse(dueDate))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "TaskSpec Due Date must be a valid date string"
        })
      }
    }
  })

export const taskSpecCreateSchema = z.object({
  markdown: taskSpecMarkdownSchema
})

export const taskSpecStructuredSchema = z.object({
  goal: z.array(z.string().min(1)).min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  requirements: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  priority: taskSpecPrioritySchema,
  dueDate: z.string().datetime().optional().nullable()
})

export const taskCreateSchema = z.object({
  title: z.string().min(2, "Task title must be at least 2 characters"),
  description: z.string().optional(),
  specMarkdown: taskSpecMarkdownSchema.optional(),
  assignmentMode: z.enum(["MANUAL", "AI_SUGGESTED", "AI_AUTO"]).optional(),
  projectId: z.string().min(1, "Project ID is required"),
  assigneeType: z.enum(["HUMAN", "AGENT", "FUNCTIONAL_AGENT"]).default("HUMAN"),
  assigneeId: z.string().optional(),
  agentId: z.string().optional(),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]).optional(),
  priority: prioritySchema,
  dueDate: z.union([
    z.string().datetime(),
    z.string().transform(val => val ? new Date(val).toISOString() : null)
  ]).optional().nullable()
})

export const taskUpdateSchema = z.object({
  title: z.string().min(2, "Task title must be at least 2 characters").optional(),
  description: z.string().optional(),
  specMarkdown: taskSpecMarkdownSchema.optional(),
  specValidationStatus: z.enum(["PENDING", "VALID", "INVALID"]).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "REVIEW", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.union([
    z.number().min(0).max(3),
    z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).transform(val => priorityMap[val])
  ]).optional(),
  assignmentMode: z.enum(["MANUAL", "AI_SUGGESTED", "AI_AUTO"]).optional(),
  assigneeType: z.enum(["HUMAN", "AGENT", "FUNCTIONAL_AGENT"]).optional(),
  assigneeId: z.string().optional().nullable(),
  agentId: z.string().optional().nullable(),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]).optional().nullable(),
  claimedAt: z.string().datetime().optional().nullable(),
  dueDate: z.union([
    z.string().datetime(),
    z.string().transform(val => val ? new Date(val).toISOString() : null)
  ]).optional().nullable()
})

export const taskAssignSchema = z.object({
  assigneeType: z.enum(["HUMAN", "AGENT", "FUNCTIONAL_AGENT"]),
  assigneeId: z.string().optional().nullable(),
  agentId: z.string().optional().nullable(),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]).optional().nullable()
})

export const taskClaimSchema = z.object({
  assigneeType: z.enum(["HUMAN", "FUNCTIONAL_AGENT"]),
  assigneeId: z.string().optional().nullable(),
  agentId: z.string().optional().nullable(),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]).optional().nullable(),
  reason: z.string().max(500).optional()
}).superRefine((value, ctx) => {
  if (value.assigneeType === "HUMAN" && !value.assigneeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "assigneeId is required when assigneeType is HUMAN",
      path: ["assigneeId"]
    })
  }
  if (value.assigneeType === "FUNCTIONAL_AGENT" && !value.functionalAgentType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Agent queue domain is required when assigneeType is FUNCTIONAL_AGENT (field: functionalAgentType)",
      path: ["functionalAgentType"]
    })
  }
})

export const taskSuggestAssigneeSchema = z.object({
  topN: z.number().int().min(1).max(10).default(3),
  weights: z.object({
    // Compatibility:
    // - new UI term: agentDomainMatch
    // - legacy API term: functionalMatch
    functionalMatch: z.number().min(0).max(1).optional(),
    agentDomainMatch: z.number().min(0).max(1).optional(),
    workload: z.number().min(0).max(1).optional(),
    deadlineRisk: z.number().min(0).max(1).optional()
  }).optional()
})

export const agentQueuePullSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]),
  claim: z.boolean().optional().default(true)
})

export const taskAutoDispatchSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  limit: z.number().int().min(1).max(20).optional().default(5),
  autoSubmit: z.boolean().optional().default(true),
  idempotencyKey: z.string().min(8).max(128).optional(),
  taskIds: z.array(z.string().min(1)).max(50).optional()
})

export const taskConfirmAssignSchema = z.object({
  assigneeType: z.enum(["HUMAN", "AGENT", "FUNCTIONAL_AGENT"]),
  assigneeId: z.string().optional().nullable(),
  agentId: z.string().optional().nullable(),
  functionalAgentType: z.enum(["PRODUCT", "ENGINEERING", "QA", "DESIGN", "OPERATIONS"]).optional().nullable(),
  assignmentMode: z.enum(["MANUAL", "AI_SUGGESTED", "AI_AUTO"]).default("MANUAL"),
  source: z.enum(["manual", "suggestion", "automation"]).optional(),
  reason: z.string().max(500).optional()
}).superRefine((value, ctx) => {
  if (value.assigneeType === "HUMAN" && !value.assigneeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "assigneeId is required when assigneeType is HUMAN",
      path: ["assigneeId"]
    })
  }
  if (value.assigneeType === "AGENT" && !value.agentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "agentId is required when assigneeType is AGENT",
      path: ["agentId"]
    })
  }
  if (value.assigneeType === "FUNCTIONAL_AGENT" && !value.functionalAgentType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Agent queue domain is required when assigneeType is FUNCTIONAL_AGENT (field: functionalAgentType)",
      path: ["functionalAgentType"]
    })
  }
})

export const taskStatusUpdateSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "REVIEW", "COMPLETED", "CANCELLED"]),
  notes: z.string().optional()
})

export const agentCreateSchema = z.object({
  name: z.string().min(2, "Agent name must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens"),
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
  description: z.string().optional(),
  type: z.enum(["AI", "AUTOMATION"]).default("AI"),
  capabilities: z.array(z.string()).optional(),
  apiEndpoint: z.string().url().optional().nullable(),
  modelConfig: z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional()
  }).optional(),
  systemPrompt: z.string().optional()
})

export const agentUpdateSchema = z.object({
  displayName: z.string().min(2, "Display name must be at least 2 characters").optional(),
  description: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  apiEndpoint: z.string().url().optional().nullable(),
  modelConfig: z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().optional()
  }).optional(),
  systemPrompt: z.string().optional(),
  isActive: z.boolean().optional()
})

export const deliverableCreateSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  name: z.string().min(2, "Deliverable name must be at least 2 characters"),
  type: z.string().min(1, "Type is required"),
  content: z.string().min(1, "Content is required"),
  createFile: z.boolean().optional().default(false)
})

export const deliverableReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  feedback: z.string().optional()
}).superRefine((value, ctx) => {
  if (value.status === "REJECTED" && !value.feedback?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "feedback is required when status is REJECTED",
      path: ["feedback"]
    })
  }
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type TeamCreateInput = z.infer<typeof teamCreateSchema>
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>
export type FileCreateInput = z.infer<typeof fileCreateSchema>
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>
export type CommentCreateInput = z.infer<typeof commentCreateSchema>
export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
export type TaskAssignInput = z.infer<typeof taskAssignSchema>
export type TaskSpecCreateInput = z.infer<typeof taskSpecCreateSchema>
export type TaskSpecStructuredInput = z.infer<typeof taskSpecStructuredSchema>
export type TaskClaimInput = z.infer<typeof taskClaimSchema>
export type TaskSuggestAssigneeInput = z.infer<typeof taskSuggestAssigneeSchema>
export type AgentQueuePullInput = z.infer<typeof agentQueuePullSchema>
export type TaskAutoDispatchInput = z.infer<typeof taskAutoDispatchSchema>
export type TaskConfirmAssignInput = z.infer<typeof taskConfirmAssignSchema>
export type TaskStatusUpdateInput = z.infer<typeof taskStatusUpdateSchema>
export type AgentCreateInput = z.infer<typeof agentCreateSchema>
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>
export type DeliverableCreateInput = z.infer<typeof deliverableCreateSchema>
export type DeliverableReviewInput = z.infer<typeof deliverableReviewSchema>
