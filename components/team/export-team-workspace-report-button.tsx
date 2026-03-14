"use client"

import { useState } from "react"

type TeamProjectItem = {
  id: string
  name: string
  status: string
}

type TeamTemplateItem = {
  id: string
  name: string
  category: string
  isBuiltIn: boolean
}

interface ExportTeamWorkspaceReportButtonProps {
  team: {
    id: string
    name: string
    description: string | null
    creatorName: string
    overview: {
      projectCount: number
      fileCount: number
      openTaskCount: number
      dueSoonTaskCount: number
      overdueTaskCount: number
    }
    projects: TeamProjectItem[]
    recommendedTemplates: TeamTemplateItem[]
  }
}

export function ExportTeamWorkspaceReportButton({ team }: ExportTeamWorkspaceReportButtonProps) {
  const [isExporting, setIsExporting] = useState(false)

  const buildFallbackReport = () => {
    const lines: string[] = []
    lines.push(`# Team Workspace Report: ${team.name}`)
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Team ID: ${team.id}`)
    lines.push(`- Created by: ${team.creatorName}`)
    lines.push("")
    lines.push("## Overview")
    lines.push(`- Projects: ${team.overview.projectCount}`)
    lines.push(`- Files: ${team.overview.fileCount}`)
    lines.push(`- Open Tasks: ${team.overview.openTaskCount}`)
    lines.push(`- Due <= 3d: ${team.overview.dueSoonTaskCount}`)
    lines.push(`- Overdue: ${team.overview.overdueTaskCount}`)
    lines.push("")
    lines.push("## Projects")
    if (team.projects.length === 0) {
      lines.push("- None")
    } else {
      for (const project of team.projects) {
        lines.push(`- ${project.name} (${project.status})`)
      }
    }
    lines.push("")
    lines.push("## Recommended Templates")
    if (team.recommendedTemplates.length === 0) {
      lines.push("- None")
    } else {
      for (const template of team.recommendedTemplates) {
        lines.push(`- ${template.name} [${template.category}]${template.isBuiltIn ? " (Built-in)" : ""}`)
      }
    }

    return lines.join("\n")
  }

  const triggerDownload = (markdown: string) => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const safeName = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "team"
    anchor.href = url
    anchor.download = `${safeName}-workspace-report-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const downloadReport = async () => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/teams/${team.id}/workspace-report?format=markdown`)
      if (response.ok) {
        const markdown = await response.text()
        triggerDownload(markdown)
        return
      }
      triggerDownload(buildFallbackReport())
    } catch {
      triggerDownload(buildFallbackReport())
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={downloadReport}
      disabled={isExporting}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {isExporting ? "Exporting..." : "Export Team Report"}
    </button>
  )
}
