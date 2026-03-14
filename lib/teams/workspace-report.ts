import { db } from "@/lib/db"
import { deriveRecommendedTemplateCategoriesFromCounts } from "@/lib/templates/recommendation"
import { TaskStatus } from "@prisma/client"

export type TeamWorkspaceReportPayload = {
  generatedAt: string
  team: {
    id: string
    name: string
    description: string | null
    creatorName: string
  }
  overview: {
    projectCount: number
    fileCount: number
    openTaskCount: number
    dueSoonTaskCount: number
    overdueTaskCount: number
  }
  projects: Array<{ id: string; name: string; status: string }>
  recommendedTemplates: Array<{
    id: string
    name: string
    category: string
    isBuiltIn: boolean
  }>
}

export async function resolveTeamWorkspaceReport(
  teamId: string,
  userId: string
): Promise<{ payload: TeamWorkspaceReportPayload; isMember: boolean; found: boolean }> {
  const teamMembership = await db.teamMember.findFirst({
    where: {
      teamId,
      userId
    },
    select: { id: true }
  })

  if (!teamMembership) {
    return {
      isMember: false,
      found: true,
      payload: {
        generatedAt: new Date().toISOString(),
        team: { id: teamId, name: "", description: null, creatorName: "" },
        overview: {
          projectCount: 0,
          fileCount: 0,
          openTaskCount: 0,
          dueSoonTaskCount: 0,
          overdueTaskCount: 0
        },
        projects: [],
        recommendedTemplates: []
      }
    }
  }

  const team = await db.team.findUnique({
    where: { id: teamId },
    include: {
      creator: {
        select: {
          name: true,
          email: true
        }
      },
      projects: {
        select: {
          id: true,
          name: true,
          status: true
        }
      }
    }
  })

  if (!team) {
    return {
      isMember: true,
      found: false,
      payload: {
        generatedAt: new Date().toISOString(),
        team: { id: teamId, name: "", description: null, creatorName: "" },
        overview: {
          projectCount: 0,
          fileCount: 0,
          openTaskCount: 0,
          dueSoonTaskCount: 0,
          overdueTaskCount: 0
        },
        projects: [],
        recommendedTemplates: []
      }
    }
  }

  const teamProjectIds = team.projects.map((project) => project.id)
  const now = new Date()
  const dueSoonBoundary = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

  const [templateUsageRows, fileCount, openTaskCount, dueSoonTaskCount, overdueTaskCount] =
    teamProjectIds.length > 0
      ? await Promise.all([
          db.file.groupBy({
            by: ["templateType"],
            where: {
              projectId: { in: teamProjectIds }
            },
            _count: { _all: true }
          }),
          db.file.count({
            where: { projectId: { in: teamProjectIds } }
          }),
          db.task.count({
            where: {
              projectId: { in: teamProjectIds },
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] }
            }
          }),
          db.task.count({
            where: {
              projectId: { in: teamProjectIds },
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
              dueDate: { lte: dueSoonBoundary }
            }
          }),
          db.task.count({
            where: {
              projectId: { in: teamProjectIds },
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.REVIEW] },
              dueDate: { lt: now }
            }
          })
        ])
      : [[], 0, 0, 0, 0]

  const recommendedCategories = deriveRecommendedTemplateCategoriesFromCounts({
    items: (templateUsageRows as Array<{ templateType: string | null; _count: { _all: number } }>).map(
      (row) => ({
        templateType: row.templateType,
        count: row._count._all
      })
    ),
    limit: 3
  })

  const recommendedTemplates = recommendedCategories.length
    ? await db.template.findMany({
        where: {
          category: { in: recommendedCategories },
          OR: [{ isPublic: true }, { creatorId: userId }]
        },
        select: {
          id: true,
          name: true,
          category: true,
          isBuiltIn: true
        },
        orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }],
        take: 6
      })
    : []

  return {
    isMember: true,
    found: true,
    payload: {
      generatedAt: new Date().toISOString(),
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        creatorName: team.creator?.name || team.creator?.email || "Unknown"
      },
      overview: {
        projectCount: team.projects.length,
        fileCount,
        openTaskCount,
        dueSoonTaskCount,
        overdueTaskCount
      },
      projects: team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status
      })),
      recommendedTemplates
    }
  }
}

export function buildTeamWorkspaceMarkdown(input: TeamWorkspaceReportPayload): string {
  const lines: string[] = []
  lines.push(`# Team Workspace Report: ${input.team.name}`)
  lines.push("")
  lines.push(`- Generated At: ${input.generatedAt}`)
  lines.push(`- Team ID: ${input.team.id}`)
  lines.push(`- Created by: ${input.team.creatorName}`)
  if (input.team.description) {
    lines.push(`- Description: ${input.team.description}`)
  }
  lines.push("")
  lines.push("## Overview")
  lines.push(`- Projects: ${input.overview.projectCount}`)
  lines.push(`- Files: ${input.overview.fileCount}`)
  lines.push(`- Open Tasks: ${input.overview.openTaskCount}`)
  lines.push(`- Due <= 3d: ${input.overview.dueSoonTaskCount}`)
  lines.push(`- Overdue: ${input.overview.overdueTaskCount}`)
  lines.push("")
  lines.push("## Projects")
  if (input.projects.length === 0) {
    lines.push("- None")
  } else {
    for (const project of input.projects) {
      lines.push(`- ${project.name} (${project.status}) [${project.id}]`)
    }
  }
  lines.push("")
  lines.push("## Recommended Templates")
  if (input.recommendedTemplates.length === 0) {
    lines.push("- None")
  } else {
    for (const template of input.recommendedTemplates) {
      lines.push(`- ${template.name} [${template.category}]${template.isBuiltIn ? " (Built-in)" : ""}`)
    }
  }

  return lines.join("\n")
}
