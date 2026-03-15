import { fetchWithTimeoutRetry } from "@/lib/client/fetch-with-timeout-retry"

describe("fetchWithTimeoutRetry", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("retries transient failures and resolves on a later success", async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await fetchWithTimeoutRetry("/api/test", {}, { maxRetries: 2, retryDelayMs: 0, timeoutMs: 1000 })
    const payload = await response.json()

    expect(response.ok).toBe(true)
    expect(payload.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws after exhausting retries", async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockRejectedValue(new Error("still failing"))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      fetchWithTimeoutRetry("/api/test", {}, { maxRetries: 1, retryDelayMs: 0, timeoutMs: 1000 })
    ).rejects.toThrow("still failing")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("aborts timed out requests and retries", async () => {
    const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted")
            ;(err as Error & { name: string }).name = "AbortError"
            reject(err)
          })
        })
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      fetchWithTimeoutRetry("/api/test", {}, { maxRetries: 1, retryDelayMs: 0, timeoutMs: 1 })
    ).rejects.toThrow("aborted")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

