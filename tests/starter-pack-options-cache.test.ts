import {
  clearStarterPackOptionsCache,
  fetchStarterPackOptionsCached
} from "@/lib/reports/starter-pack-options-cache"

describe("starter-pack-options-cache", () => {
  beforeEach(() => {
    clearStarterPackOptionsCache()
    jest.restoreAllMocks()
  })

  it("returns cached starter packs within ttl window", async () => {
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        packs: [{ id: "PM_STARTER", name: "PM Starter", description: "desc", templateIds: ["tpl1"] }]
      })
    } as Response)

    const first = await fetchStarterPackOptionsCached({ ttlMs: 60_000 })
    const second = await fetchStarterPackOptionsCached({ ttlMs: 60_000 })

    expect(first).toEqual([{ id: "PM_STARTER", name: "PM Starter", description: "desc", templateIds: ["tpl1"] }])
    expect(second).toEqual([{ id: "PM_STARTER", name: "PM Starter", description: "desc", templateIds: ["tpl1"] }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("supports force refresh", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          packs: [{ id: "PM_STARTER", name: "Pack A", description: "", templateIds: ["t1"] }]
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          packs: [{ id: "PM_STARTER", name: "Pack B", description: "", templateIds: ["t2"] }]
        })
      } as Response)

    await fetchStarterPackOptionsCached({ ttlMs: 60_000 })
    const refreshed = await fetchStarterPackOptionsCached({ ttlMs: 60_000, forceRefresh: true })

    expect(refreshed[0].name).toBe("Pack B")
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
        return {
          packs: [{ id: "OPS_INCIDENT_STARTER", name: "Ops", description: "ops", templateIds: ["t1"] }]
        }
      }
    } as Response)

    const pendingA = fetchStarterPackOptionsCached()
    const pendingB = fetchStarterPackOptionsCached()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    releaseJson()

    const [a, b] = await Promise.all([pendingA, pendingB])
    expect(a).toEqual([{ id: "OPS_INCIDENT_STARTER", name: "Ops", description: "ops", templateIds: ["t1"] }])
    expect(b).toEqual([{ id: "OPS_INCIDENT_STARTER", name: "Ops", description: "ops", templateIds: ["t1"] }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
