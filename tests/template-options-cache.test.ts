import { clearTemplateOptionsCache, fetchTemplateOptionsCached } from "@/lib/reports/template-options-cache"

describe("template-options-cache", () => {
  beforeEach(() => {
    clearTemplateOptionsCache()
    jest.restoreAllMocks()
  })

  it("returns cached templates within ttl window", async () => {
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: "tpl1", name: "Template One", category: "CUSTOM" }]
    } as Response)

    const first = await fetchTemplateOptionsCached({ ttlMs: 60_000 })
    const second = await fetchTemplateOptionsCached({ ttlMs: 60_000 })

    expect(first).toEqual([{ id: "tpl1", name: "Template One", category: "CUSTOM", description: null }])
    expect(second).toEqual([{ id: "tpl1", name: "Template One", category: "CUSTOM", description: null }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("separates cache by visibility key", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "tpl1", name: "All Template", category: "CUSTOM" }]
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "tpl2", name: "Built-in Template", category: "CUSTOM" }]
      } as Response)

    const allTemplates = await fetchTemplateOptionsCached({ ttlMs: 60_000 })
    const builtInTemplates = await fetchTemplateOptionsCached({ visibility: "BUILT_IN", ttlMs: 60_000 })

    expect(allTemplates[0].id).toBe("tpl1")
    expect(builtInTemplates[0].id).toBe("tpl2")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("deduplicates concurrent requests for same key", async () => {
    let releaseJson!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseJson = resolve
    })

    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => {
        await gate
        return [{ id: "tpl1", name: "Template One", category: "CUSTOM" }]
      }
    } as Response)

    const pendingA = fetchTemplateOptionsCached({ visibility: "BUILT_IN" })
    const pendingB = fetchTemplateOptionsCached({ visibility: "BUILT_IN" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    releaseJson()

    const [a, b] = await Promise.all([pendingA, pendingB])
    expect(a).toEqual([{ id: "tpl1", name: "Template One", category: "CUSTOM", description: null }])
    expect(b).toEqual([{ id: "tpl1", name: "Template One", category: "CUSTOM", description: null }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
