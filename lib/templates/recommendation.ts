import { TemplateCategory } from "@prisma/client"

const CATEGORY_SET = new Set(Object.values(TemplateCategory))

export function normalizeTemplateCategory(input: string | null | undefined): TemplateCategory | null {
  if (!input) return null
  const normalized = input.trim().toUpperCase()
  if (!normalized) return null
  if (!CATEGORY_SET.has(normalized as TemplateCategory)) return null
  return normalized as TemplateCategory
}

export function deriveRecommendedTemplateCategories(input: {
  templateTypes: Array<string | null | undefined>
  limit?: number
}): TemplateCategory[] {
  const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : 3
  const counts = new Map<TemplateCategory, number>()

  for (const item of input.templateTypes) {
    const category = normalizeTemplateCategory(item)
    if (!category) continue
    counts.set(category, (counts.get(category) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category]) => category)
}

export function deriveRecommendedTemplateCategoriesFromCounts(input: {
  items: Array<{ templateType: string | null | undefined; count: number }>
  limit?: number
}): TemplateCategory[] {
  const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : 3
  const counts = new Map<TemplateCategory, number>()

  for (const item of input.items) {
    const category = normalizeTemplateCategory(item.templateType)
    if (!category) continue
    const increment = Number.isFinite(item.count) ? Math.max(0, item.count) : 0
    counts.set(category, (counts.get(category) || 0) + increment)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category]) => category)
}
