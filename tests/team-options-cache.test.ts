import { clearTeamOptionsCache, fetchTeamOptionsCached } from "@/lib/reports/team-options-cache"

describe("team-options-cache", () => {
  beforeEach(() => {
    clearTeamOptionsCache()
    jest.restoreAllMocks()
  })

  it("returns cached teams within ttl window", async () => {
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: "t1", name: "Team One" }]
    } as Response)

    const first = await fetchTeamOptionsCached({ ttlMs: 60_000 })
    const second = await fetchTeamOptionsCached({ ttlMs: 60_000 })

    expect(first).toEqual([{ id: "t1", name: "Team One" }])
    expect(second).toEqual([{ id: "t1", name: "Team One" }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("forces refresh when requested", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "t1", name: "Team One" }]
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "t2", name: "Team Two" }]
      } as Response)

    const first = await fetchTeamOptionsCached({ ttlMs: 60_000 })
    const second = await fetchTeamOptionsCached({ forceRefresh: true, ttlMs: 60_000 })

    expect(first).toEqual([{ id: "t1", name: "Team One" }])
    expect(second).toEqual([{ id: "t2", name: "Team Two" }])
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
        return [{ id: "t1", name: "Team One" }]
      }
    } as Response)

    const pendingA = fetchTeamOptionsCached({ ttlMs: 60_000 })
    const pendingB = fetchTeamOptionsCached({ ttlMs: 60_000 })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    releaseJson()
    const [a, b] = await Promise.all([pendingA, pendingB])

    expect(a).toEqual([{ id: "t1", name: "Team One" }])
    expect(b).toEqual([{ id: "t1", name: "Team One" }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
