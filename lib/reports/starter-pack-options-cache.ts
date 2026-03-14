import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export interface StarterPackOption {
  id: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
  name: string
  description: string
  templateIds: string[]
}

const starterPackCache = new Map<string, { expiresAt: number; items: StarterPackOption[] }>()
const inFlight = new Map<string, Promise<StarterPackOption[]>>()

const CACHE_KEY = "starter-packs:default"

async function requestStarterPackOptions(): Promise<StarterPackOption[]> {
  const response = await fetch("/api/templates/starter-packs")
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load starter packs"))
  }
  const packs = Array.isArray(payload?.packs) ? payload.packs : []
  return packs
    .map((pack: any) => ({
      id:
        pack?.id === "PM_STARTER" || pack?.id === "IT_RD_STARTER" || pack?.id === "OPS_INCIDENT_STARTER"
          ? (pack.id as StarterPackOption["id"])
          : null,
      name: typeof pack?.name === "string" ? pack.name : "",
      description: typeof pack?.description === "string" ? pack.description : "",
      templateIds: Array.isArray(pack?.templateIds)
        ? pack.templateIds.filter((id: unknown): id is string => typeof id === "string")
        : []
    }))
    .filter((pack: { id: StarterPackOption["id"] | null; name: string }): pack is StarterPackOption => Boolean(pack.id) && pack.name.length > 0)
}

export async function fetchStarterPackOptionsCached({
  ttlMs = 45_000,
  forceRefresh = false
}: {
  ttlMs?: number
  forceRefresh?: boolean
} = {}): Promise<StarterPackOption[]> {
  const now = Date.now()
  const cached = starterPackCache.get(CACHE_KEY)
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.items
  }

  const pending = inFlight.get(CACHE_KEY)
  if (pending) return pending

  const request = requestStarterPackOptions()
    .then((items) => {
      starterPackCache.set(CACHE_KEY, { expiresAt: Date.now() + ttlMs, items })
      return items
    })
    .finally(() => {
      inFlight.delete(CACHE_KEY)
    })

  inFlight.set(CACHE_KEY, request)
  return request
}

export function clearStarterPackOptionsCache() {
  starterPackCache.clear()
}
