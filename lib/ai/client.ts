import OpenAI from "openai"

interface GenerateContentOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  baseURL?: string
}

export async function createOpenAIClient(apiKey: string, baseURL?: string) {
  if (!apiKey) {
    throw new Error("API key is required")
  }

  return new OpenAI({
    apiKey,
    baseURL: baseURL || "https://api.openai.com/v1"
  })
}

export async function generateContent(
  apiKey: string,
  prompt: string,
  options: GenerateContentOptions = {}
): Promise<string> {
  const client = await createOpenAIClient(apiKey, options.baseURL)

  const response = await client.chat.completions.create({
    model: options.model || "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant. Generate pure Markdown output without any platform-specific tags or formatting. Use standard Markdown syntax only."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: options.maxTokens || 2000,
    temperature: options.temperature || 0.7
  })

  return response.choices[0]?.message?.content || ""
}

export async function validateApiKey(apiKey: string, baseURL?: string): Promise<boolean> {
  try {
    const client = await createOpenAIClient(apiKey, baseURL)
    await client.models.list()
    return true
  } catch (error) {
    return false
  }
}
