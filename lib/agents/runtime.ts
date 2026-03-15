import { db } from "@/lib/db"
import { generateContent } from "@/lib/ai/client"
import { decrypt } from "@/lib/utils/encryption"
import { FunctionalAgentType } from "@prisma/client"

type RuntimeTask = {
  id: string
  title: string
  description: string | null
  specMarkdown: string | null
  agentId: string | null
  functionalAgentType: FunctionalAgentType | null
}

type RuntimeOptions = {
  task: RuntimeTask
  executionId: string
  executionNotes?: string
}

type RuntimeResult = {
  output: string
  mode: "ENDPOINT" | "MODEL" | "RULE_BASED"
  targetAgent: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AgentRuntimeError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 500) {
    super(message)
    this.name = "AgentRuntimeError"
    this.code = code
    this.status = status
  }
}

async function withRetry<T>(
  run: () => Promise<T>,
  options: {
    attempts: number
    retryableCodes: string[]
    backoffMs?: number
  }
): Promise<T> {
  const { attempts, retryableCodes, backoffMs = 300 } = options
  let lastError: unknown = null

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      const isRetryable =
        error instanceof AgentRuntimeError && retryableCodes.includes(error.code)
      const hasNext = index < attempts - 1
      if (!isRetryable || !hasNext) {
        throw error
      }
      await sleep(backoffMs * (index + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Runtime retry failed")
}

function extractAgentOutput(payload: any): string {
  if (!payload) return ""
  if (typeof payload === "string") return payload
  if (typeof payload.output === "string") return payload.output
  if (typeof payload.content === "string") return payload.content
  if (typeof payload.markdown === "string") return payload.markdown
  return ""
}

function buildUserPrompt(task: RuntimeTask, executionId: string, executionNotes?: string): string {
  return `Execute the task and return Markdown deliverable only.

Execution ID: ${executionId}
Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description || "(none)"}
Agent Queue Domain: ${task.functionalAgentType || "UNSPECIFIED"}
Execution Notes: ${executionNotes || "(none)"}

TaskSpec:
${task.specMarkdown || "(empty)"}

Output requirements:
1. Provide clear objective and implementation/result summary.
2. Include completed deliverables checklist.
3. Include quality/risk notes.
4. Include next actions.
`
}

function buildRuleBasedOutput(task: RuntimeTask, executionId: string, executionNotes?: string): string {
  return `# Agent Execution Result

- Execution ID: ${executionId}
- Strategy: Rule-based synthesis fallback
- Queue Domain: ${task.functionalAgentType || "UNSPECIFIED"}

## Objective
- ${task.title}
- ${task.description || "No additional description provided."}

## Deliverables
- TaskSpec reviewed and converted into action summary.
- Initial implementation/output draft generated.

## Requirements Coverage
- Goal understood from TaskSpec.
- Deliverables and acceptance criteria mapped to actionable checks.

## Notes
- ${executionNotes || "No extra execution notes."}
- For higher-quality output, configure an active agent endpoint or model key.
`
}

async function callWithTimeout(
  url: string,
  payload: unknown,
  apiKey: string | null,
  timeoutMs = 45000
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    const text = await response.text()
    if (!response.ok) {
      throw new AgentRuntimeError(
        "AGENT_ENDPOINT_ERROR",
        `Agent endpoint returned ${response.status}: ${text || "empty response"}`,
        502
      )
    }

    try {
      return JSON.parse(text)
    } catch {
      return { output: text }
    }
  } catch (error) {
    if (error instanceof AgentRuntimeError) {
      throw error
    }
    if ((error as Error).name === "AbortError") {
      throw new AgentRuntimeError("AGENT_EXECUTION_TIMEOUT", "Agent execution timed out", 504)
    }
    throw new AgentRuntimeError("AGENT_ENDPOINT_ERROR", "Failed to call agent endpoint", 502)
  } finally {
    clearTimeout(timer)
  }
}

export async function executeTaskWithAgent(options: RuntimeOptions): Promise<RuntimeResult> {
  const { task, executionId, executionNotes } = options
  const userPrompt = buildUserPrompt(task, executionId, executionNotes)

  if (task.agentId) {
    const agent = await db.agent.findUnique({
      where: { id: task.agentId },
      select: {
        id: true,
        isActive: true,
        apiEndpoint: true,
        apiKeyEncrypted: true,
        modelConfig: true,
        systemPrompt: true
      }
    })

    if (!agent || !agent.isActive) {
      throw new AgentRuntimeError("AGENT_NOT_AVAILABLE", "Assigned agent not found or inactive", 400)
    }

    const apiKey = agent.apiKeyEncrypted ? decrypt(agent.apiKeyEncrypted) : null
    const modelConfig = (agent.modelConfig ?? {}) as {
      model?: string
      temperature?: number
      maxTokens?: number
      baseURL?: string
    }

    if (agent.apiEndpoint) {
      const endpointPayload = {
        executionId,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          specMarkdown: task.specMarkdown,
          functionalAgentType: task.functionalAgentType
        },
        notes: executionNotes || null
      }

      const endpointResponse = await withRetry(
        () =>
          callWithTimeout(
            agent.apiEndpoint as string,
            endpointPayload,
            apiKey
          ),
        {
          attempts: 2,
          retryableCodes: ["AGENT_EXECUTION_TIMEOUT", "AGENT_ENDPOINT_ERROR"],
          backoffMs: 400
        }
      )
      const endpointOutput = extractAgentOutput(endpointResponse).trim()
      if (endpointOutput) {
        return {
          output: endpointOutput,
          mode: "ENDPOINT",
          targetAgent: `agent:${agent.id}`
        }
      }
    }

    if (apiKey) {
      const content = await withRetry(
        async () => {
          try {
            return await generateContent(apiKey, userPrompt, {
              model: modelConfig.model || "gpt-4o-mini",
              maxTokens: modelConfig.maxTokens || 2400,
              temperature: modelConfig.temperature ?? 0.2,
              baseURL: modelConfig.baseURL
            })
          } catch {
            throw new AgentRuntimeError("AGENT_ENDPOINT_ERROR", "Agent model execution failed", 502)
          }
        },
        {
          attempts: 2,
          retryableCodes: ["AGENT_ENDPOINT_ERROR", "AGENT_EXECUTION_TIMEOUT"],
          backoffMs: 300
        }
      )

      if (content?.trim()) {
        return {
          output: content.trim(),
          mode: "MODEL",
          targetAgent: `agent:${agent.id}`
        }
      }
    }
  }

  return {
    output: buildRuleBasedOutput(task, executionId, executionNotes),
    mode: "RULE_BASED",
    targetAgent: task.agentId
      ? `agent:${task.agentId}`
      : `queue:${task.functionalAgentType ?? "UNSPECIFIED"}`
  }
}
