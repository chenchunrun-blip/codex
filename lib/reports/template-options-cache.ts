import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

export interface TemplateOption {
  id: string
  name: string
  category: string
  description?: string | null
}

const templateCache = new Map<string, { expiresAt: number; items: TemplateOption[] }>()
const inFlight = new Map<string, Promise<TemplateOption[]>>()

function buildKey(visibility?: string) {
  return visibility ? `visibility:${visibility}` : "visibility:ALL"
}

async function requestTemplateOptions(visibility?: string): Promise<TemplateOption[]> {
  const query = visibility ? `?visibility=${encodeURIComponent(visibility)}` : ""
  const response = await fetch(`/api/templates${query}`)
  const payload = await response.json().catch(() => [])
  if (!response.ok) {
    throw new Error(mapReportApiErrorFromPayload(payload, "Failed to load templates"))
  }
  if (!Array.isArray(payload)) return []
  return payload
    .map((item) => ({
      id: typeof item?.id === "string" ? item.id : "",
      name: typeof item?.name === "string" ? item.name : "",
      category: typeof item?.category === "string" ? item.category : "CUSTOM",
      description: typeof item?.description === "string" ? item.description : null
    }))
    .filter((item) => item.id && item.name)
}

export async function fetchTemplateOptionsCached({
  visibility,
  ttlMs = 45_000,
  forceRefresh = false
}: {
  visibility?: string
  ttlMs?: number
  forceRefresh?: boolean
} = {}): Promise<TemplateOption[]> {
  const key = buildKey(visibility)
  const now = Date.now()
  const cached = templateCache.get(key)
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.items
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = requestTemplateOptions(visibility)
    .then((items) => {
      templateCache.set(key, { expiresAt: Date.now() + ttlMs, items })
      return items
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, request)
  return request
}

export function clearTemplateOptionsCache() {
  templateCache.clear()
}
