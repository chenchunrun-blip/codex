export type StarterPackId = "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"

export type StarterTemplateItem = {
  id: string
  name: string
  category: string
}

export type StarterPack = {
  id: StarterPackId
  name: string
  description: string
  templateIds: string[]
}

function findTemplateIdByName(
  templates: StarterTemplateItem[],
  names: string[]
): string[] {
  const lookup = new Map(templates.map((template) => [template.name.toLowerCase(), template.id]))
  return names
    .map((name) => lookup.get(name.toLowerCase()) || null)
    .filter((value): value is string => Boolean(value))
}

function findTopCategoryTemplateId(
  templates: StarterTemplateItem[],
  categories: string[]
): string[] {
  const normalized = categories.map((item) => item.toUpperCase())
  return normalized
    .map((category) =>
      templates.find((template) => template.category.toUpperCase() === category)?.id || null
    )
    .filter((value): value is string => Boolean(value))
}

function mergeTemplateIds(...groups: string[][]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(id)
    }
  }
  return merged
}

export function deriveStarterTemplatePacks(templates: StarterTemplateItem[]): StarterPack[] {
  const pmPreferred = findTemplateIdByName(templates, [
    "Project Charter (PM)",
    "Product Requirement Document (PRD)",
    "Sprint Plan & Execution Board",
    "Risk Register & Mitigation Plan",
    "Stakeholder Communication Plan",
    "Change Request (Scope / Timeline / Cost)",
    "Retrospective Summary"
  ])
  const pmFallback = findTopCategoryTemplateId(templates, [
    "PROBLEM_DEFINITION",
    "EXECUTION_TRACKING",
    "RETROSPECTIVE_SUMMARY"
  ])
  const pmTemplates = mergeTemplateIds(pmPreferred, pmFallback)

  const itPreferred = findTemplateIdByName(templates, [
    "Technical Design Document (IT R&D)",
    "API Specification (Backend)",
    "QA Test Plan (IT Delivery)",
    "Architecture Decision Record (ADR)",
    "Service Operations Runbook",
    "Data Migration Plan",
    "Release Readiness Checklist"
  ])
  const itFallback = findTopCategoryTemplateId(templates, [
    "SOLUTION_DESIGN",
    "EXECUTION_TRACKING",
    "RETROSPECTIVE_SUMMARY"
  ])
  const itTemplates = mergeTemplateIds(itPreferred, itFallback)

  const opsPreferred = findTemplateIdByName(templates, [
    "Incident Postmortem (IT Ops)",
    "Service Operations Runbook",
    "Release Readiness Checklist",
    "QA Test Plan (IT Delivery)",
    "Architecture Decision Record (ADR)"
  ])
  const opsFallback = findTopCategoryTemplateId(templates, [
    "RETROSPECTIVE_SUMMARY",
    "SOLUTION_DESIGN",
    "EXECUTION_TRACKING"
  ])
  const opsTemplates = mergeTemplateIds(opsPreferred, opsFallback)

  const packs: StarterPack[] = [
    {
      id: "PM_STARTER",
      name: "PM Starter",
      description: "Charter + PRD + sprint governance + risk/change control + retrospective",
      templateIds: pmTemplates
    },
    {
      id: "IT_RD_STARTER",
      name: "IT R&D Starter",
      description: "TDD + API/QA/ADR + release + runbook + migration",
      templateIds: itTemplates
    },
    {
      id: "OPS_INCIDENT_STARTER",
      name: "Ops Incident Starter",
      description: "Postmortem + runbook + release checklist + QA/ADR controls",
      templateIds: opsTemplates
    }
  ]
  return packs.filter((pack) => pack.templateIds.length > 0)
}
