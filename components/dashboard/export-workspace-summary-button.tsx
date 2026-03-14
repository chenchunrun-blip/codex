"use client"

import { useState } from "react"

interface ExportWorkspaceSummaryButtonProps {
  userName: string
  stats: {
    teams: number
    projects: number
    files: number
  }
  recentTeams: Array<{ id: string; name: string; projectCount: number; memberCount: number }>
  recentProjects: Array<{ id: string; name: string; teamName: string; fileCount: number }>
  recentFiles: Array<{ id: string; name: string; projectName: string; updatedAt: string }>
  reportEndpoint?: string
}

export function ExportWorkspaceSummaryButton({
  userName,
  stats,
  recentTeams,
  recentProjects,
  recentFiles,
  reportEndpoint = "/api/workspace/report"
}: ExportWorkspaceSummaryButtonProps) {
  const [loading, setLoading] = useState(false)

  const buildLocalReport = () => {
    const lines: string[] = []
    lines.push(`# Workspace Summary: ${userName}`)
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Teams: ${stats.teams}`)
    lines.push(`- Projects: ${stats.projects}`)
    lines.push(`- Files: ${stats.files}`)
    lines.push("")
    lines.push("## Recent Teams")
    if (recentTeams.length === 0) {
      lines.push("- None")
    } else {
      for (const team of recentTeams) {
        lines.push(`- ${team.name}: projects=${team.projectCount}, members=${team.memberCount}`)
      }
    }
    lines.push("")
    lines.push("## Recent Projects")
    if (recentProjects.length === 0) {
      lines.push("- None")
    } else {
      for (const project of recentProjects) {
        lines.push(`- ${project.name} (${project.teamName}): files=${project.fileCount}`)
      }
    }
    lines.push("")
    lines.push("## Recent Files")
    if (recentFiles.length === 0) {
      lines.push("- None")
    } else {
      for (const file of recentFiles) {
        lines.push(`- ${file.name} (${file.projectName}) · updated ${new Date(file.updatedAt).toISOString()}`)
      }
    }
    return lines.join("\n")
  }

  const downloadReport = async () => {
    setLoading(true)
    let markdown = ""
    try {
      const response = await fetch(`${reportEndpoint}?format=markdown`)
      if (response.ok) {
        markdown = await response.text()
      } else {
        markdown = buildLocalReport()
      }
    } catch {
      markdown = buildLocalReport()
    } finally {
      setLoading(false)
    }

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `workspace-summary-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={downloadReport}
      disabled={loading}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {loading ? "Exporting..." : "Export Workspace"}
    </button>
  )
}
