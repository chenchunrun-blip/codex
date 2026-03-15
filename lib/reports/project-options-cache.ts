import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export interface ProjectOption {
  id: string
  name: string
}

let cache: { expiresAt: number; items: ProjectOption[] } | null = null
let inFlight: Promise<ProjectOption[]> | null = null

async function requestProjectOptions(): Promise<ProjectOption[]> {
  const response = await fetch("/api/projects")
  const payload = await response.json().catch(() => [])
  if (!response.ok) {
    throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load projects"))
  }
  if (!Array.isArray(payload)) return []
  return payload.filter(
    (item): item is ProjectOption =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { name?: unknown }).name === "string"
  )
}

export async function fetchProjectOptionsCached({
  ttlMs = 45_000,
  forceRefresh = false
}: {
  ttlMs?: number
  forceRefresh?: boolean
} = {}): Promise<ProjectOption[]> {
  const now = Date.now()
  if (!forceRefresh && cache && cache.expiresAt > now) {
    return cache.items
  }

  if (inFlight) {
    return inFlight
  }

  inFlight = requestProjectOptions()
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

export function clearProjectOptionsCache() {
  cache = null
}
