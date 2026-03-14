import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export interface TeamOption {
  id: string
  name: string
}

let cache: { expiresAt: number; items: TeamOption[] } | null = null
let inFlight: Promise<TeamOption[]> | null = null

async function requestTeamOptions(): Promise<TeamOption[]> {
  const response = await fetch("/api/teams")
  const payload = await response.json().catch(() => [])
  if (!response.ok) {
    throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load teams"))
  }
  if (!Array.isArray(payload)) return []
  return payload.filter(
    (item): item is TeamOption =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { name?: unknown }).name === "string"
  )
}

export async function fetchTeamOptionsCached({
  ttlMs = 45_000,
  forceRefresh = false
}: {
  ttlMs?: number
  forceRefresh?: boolean
} = {}): Promise<TeamOption[]> {
  const now = Date.now()
  if (!forceRefresh && cache && cache.expiresAt > now) {
    return cache.items
  }

  if (inFlight) {
    return inFlight
  }

  inFlight = requestTeamOptions()
    .then((items) => {
      cache = {
        expiresAt: Date.now() + ttlMs,
        items
      }
      return items
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function clearTeamOptionsCache() {
  cache = null
}
