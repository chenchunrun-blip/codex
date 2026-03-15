"use client"

type PortfolioProjectItem = {
  id: string
  name: string
  teamName: string
  status: string
  fileCount: number
  memberCount: number
  recommendationCount: number
  atRiskDomainCount: number
  highRiskTaskCount: number
  updatedAt: string
}

interface ExportProjectsPortfolioButtonProps {
  projects: PortfolioProjectItem[]
}

export function ExportProjectsPortfolioButton({ projects }: ExportProjectsPortfolioButtonProps) {
  const downloadReport = () => {
    const lines: string[] = []
    lines.push("# Project Portfolio Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Projects: ${projects.length}`)
    lines.push("")
    lines.push("| Project | Team | Status | Files | Members | Actions | At-Risk Domains | High-Risk Tasks | Updated At |")
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for (const project of projects) {
      lines.push(
        `| ${project.name.replace(/\|/g, "\\|")} | ${project.teamName.replace(/\|/g, "\\|")} | ${project.status} | ${project.fileCount} | ${project.memberCount} | ${project.recommendationCount} | ${project.atRiskDomainCount} | ${project.highRiskTaskCount} | ${new Date(project.updatedAt).toISOString()} |`
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `project-portfolio-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={downloadReport}
      disabled={projects.length === 0}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      Export Portfolio
    </button>
  )
}
