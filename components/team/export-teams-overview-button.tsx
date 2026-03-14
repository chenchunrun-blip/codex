"use client"

type TeamOverviewItem = {
  id: string
  name: string
  description: string | null
  memberCount: number
  projectCount: number
  starterRuns7d?: number
  createdAt: string
}

interface ExportTeamsOverviewButtonProps {
  teams: TeamOverviewItem[]
}

export function ExportTeamsOverviewButton({ teams }: ExportTeamsOverviewButtonProps) {
  const download = () => {
    const lines: string[] = []
    lines.push("# Teams Overview Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Teams: ${teams.length}`)
    lines.push("")
    lines.push("| Team | Description | Members | Projects | Starter Rollouts (7d) | Created At |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const team of teams) {
      lines.push(
        `| ${team.name.replace(/\|/g, "\\|")} | ${(team.description || "").replace(/\|/g, "\\|")} | ${team.memberCount} | ${team.projectCount} | ${team.starterRuns7d || 0} | ${new Date(team.createdAt).toISOString()} |`
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `teams-overview-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={teams.length === 0}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      Export Teams
    </button>
  )
}
