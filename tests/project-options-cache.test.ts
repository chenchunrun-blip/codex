import { clearProjectOptionsCache, fetchProjectOptionsCached } from "@/lib/reports/project-options-cache"

describe("project-options-cache", () => {
  beforeEach(() => {
    clearProjectOptionsCache()
    jest.restoreAllMocks()
  })

  it("returns cached items within ttl window", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValue({
        ok: true,
        json: async () => [{ id: "p1", name: "Project One" }]
      } as Response)

    const first = await fetchProjectOptionsCached({ ttlMs: 60_000 })
    const second = await fetchProjectOptionsCached({ ttlMs: 60_000 })

    expect(first).toEqual([{ id: "p1", name: "Project One" }])
    expect(second).toEqual([{ id: "p1", name: "Project One" }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("forces refresh when forceRefresh is true", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "p1", name: "Project One" }]
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "p2", name: "Project Two" }]
      } as Response)

    const first = await fetchProjectOptionsCached({ ttlMs: 60_000 })
    const second = await fetchProjectOptionsCached({ forceRefresh: true, ttlMs: 60_000 })

    expect(first).toEqual([{ id: "p1", name: "Project One" }])
    expect(second).toEqual([{ id: "p2", name: "Project Two" }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("deduplicates concurrent requests", async () => {
    let releaseJson!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseJson = resolve
    })

    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => {
        await gate
        return [{ id: "p1", name: "Project One" }]
      }
    } as Response)

    const pendingA = fetchProjectOptionsCached({ ttlMs: 60_000 })
    const pendingB = fetchProjectOptionsCached({ ttlMs: 60_000 })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    releaseJson()

    const [a, b] = await Promise.all([pendingA, pendingB])
    expect(a).toEqual([{ id: "p1", name: "Project One" }])
    expect(b).toEqual([{ id: "p1", name: "Project One" }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
