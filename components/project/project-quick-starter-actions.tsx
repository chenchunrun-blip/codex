"use client"

import { useEffect, useState } from "react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"
import { fetchStarterPackOptionsCached } from "@/lib/reports/starter-pack-options-cache"

type StarterPack = {
  id: "PM_STARTER" | "IT_RD_STARTER" | "OPS_INCIDENT_STARTER"
  name: string
}

interface ProjectQuickStarterActionsProps {
  projectId: string
  currentUserRole: "ADMIN" | "EDITOR" | "VIEWER"
}

export function ProjectQuickStarterActions({
  projectId,
  currentUserRole
}: ProjectQuickStarterActionsProps) {
  const [packs, setPacks] = useState<StarterPack[]>([])
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null)
  const [loadingPacks, setLoadingPacks] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "EDITOR"

  useEffect(() => {
    setLoadingPacks(true)
    setLoadError(null)
    fetchStarterPackOptionsCached()
      .then((items) => setPacks(Array.isArray(items) ? items : []))
      .catch((error) => {
        setPacks([])
        setLoadError(error instanceof Error ? error.message : "Failed to load starter packs")
      })
      .finally(() => setLoadingPacks(false))
  }, [])

  const applyPack = async (packId: StarterPack["id"]) => {
    if (!canEdit || loadingPackId) return
    setLoadingPackId(packId)
    setInfo(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/starter-files/apply-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          skipExistingByTemplateType: true
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to apply starter pack"))
      }
      setInfo(`Created ${payload.createdCount || 0}, skipped ${payload.skippedCount || 0}`)
    } catch (error) {
      setInfo(error instanceof Error ? error.message : "Failed to apply starter pack")
    } finally {
      setLoadingPackId(null)
    }
  }

  if (loadingPacks) {
    return (
      <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-500">
        Loading starter packs...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
        {loadError}
      </div>
    )
  }

  if (packs.length === 0) return null

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2">
      <div className="mb-1 text-[11px] font-medium text-gray-600">Quick Starter</div>
      <div className="flex flex-wrap gap-1">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => applyPack(pack.id)}
            disabled={!canEdit || loadingPackId === pack.id}
            className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {loadingPackId === pack.id ? "Applying..." : pack.name}
          </button>
        ))}
      </div>
      {info && <div className="mt-1 text-[11px] text-gray-600">{info}</div>}
    </div>
  )
}
