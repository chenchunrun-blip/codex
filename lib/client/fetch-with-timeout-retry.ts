type FetchWithTimeoutRetryOptions = {
  timeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 300

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithTimeoutRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutRetryOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal
      })
      clearTimeout(timeout)
      return response
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * (attempt + 1))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed after retries")
}

