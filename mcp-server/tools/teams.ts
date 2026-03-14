/**
 * MCP Tools for Team Information
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { db } from '../../lib/db'

// ============ Schemas ============

export const GetTeamInfoSchema = z.object({
  teamId: z.string().optional(),
  projectId: z.string().optional()
}).refine(data => data.teamId || data.projectId, {
  message: 'Either teamId or projectId must be provided'
})

export const ListTeamMembersSchema = z.object({
  teamId: z.string().min(1, 'Team ID is required')
})

export const GetProjectTeamAssignmentsSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required')
})

// ============ Tool Definitions ============

export const getTeamInfoTool: Tool = {
  name: 'get_team_info',
  description: 'Get information about a team by teamId or projectId. Returns team details including name, description, and member count.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      teamId: {
        type: 'string' as const,
        description: 'The ID of the team'
      },
      projectId: {
        type: 'string' as const,
        description: 'The ID of the project (to find its associated team)'
      }
    }
  }
}

export const listTeamMembersTool: Tool = {
  name: 'list_team_members',
  description: 'List all members of a team with their roles and join dates.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      teamId: {
        type: 'string' as const,
        description: 'The ID of the team'
      }
    },
    required: ['teamId']
  }
}

export const getProjectTeamAssignmentsTool: Tool = {
  name: 'get_project_team_assignments',
  description: 'Get complete task assignment information for a project. Returns all tasks with their assignees (human users or AI agents), task status, and deliverables.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectId: {
        type: 'string' as const,
        description: 'The ID of the project to get task assignments for'
      }
    },
    required: ['projectId']
  }
}

// ============ Tool Handlers ============

export interface ToolHandlerContext {
  agentId: string
  agentName: string
}

export async function handleGetTeamInfo(
  args: unknown,
  _context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = GetTeamInfoSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { teamId, projectId } = parsed.data

  try {
    let team

    if (teamId) {
      team = await db.team.findUnique({
        where: { id: teamId },
        include: {
          _count: {
            select: {
              members: true,
              projects: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      })
    } else if (projectId) {
      // Get team through project
      const project = await db.project.findUnique({
        where: { id: projectId },
        include: {
          team: {
            include: {
              _count: {
                select: {
                  members: true,
                  projects: true
                }
              },
              creator: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          }
        }
      })
      team = project?.team
    }

    if (!team) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Team not found',
            teamId,
            projectId
          }, null, 2)
        }]
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: team.id,
          name: team.name,
          description: team.description,
          avatar: team.avatar,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
          creator: team.creator,
          stats: {
            memberCount: team._count.members,
            projectCount: team._count.projects
          }
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to get team info',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}

export async function handleListTeamMembers(
  args: unknown,
  _context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = ListTeamMembersSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { teamId } = parsed.data

  try {
    const members = await db.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            nickname: true,
            avatar: true
          }
        }
      },
      orderBy: {
        joinedAt: 'asc'
      }
    })

    const team = await db.team.findUnique({
      where: { id: teamId },
      select: { name: true }
    })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          teamId,
          teamName: team?.name,
          members: members.map(m => ({
            id: m.id,
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            nickname: m.user.nickname,
            avatar: m.user.avatar,
            role: m.role,
            joinedAt: m.joinedAt
          })),
          count: members.length
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to list team members',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}

export async function handleGetProjectTeamAssignments(
  args: unknown,
  _context: ToolHandlerContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = GetProjectTeamAssignmentsSchema.safeParse(args)

  if (!parsed.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Invalid arguments',
          details: parsed.error.issues
        }, null, 2)
      }]
    }
  }

  const { projectId } = parsed.data

  try {
    // Get project info with team
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        team: {
          select: {
            id: true,
            name: true
          }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                nickname: true,
                avatar: true
              }
            }
          }
        },
        tasks: {
          include: {
            assignee: {
              select: {
                id: true,
                name: true,
                email: true,
                nickname: true
              }
            },
            agent: {
              select: {
                id: true,
                name: true,
                displayName: true,
                type: true
              }
            },
            creator: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            deliverables: {
              select: {
                id: true,
                name: true,
                type: true,
                status: true,
                submittedAt: true,
                reviewedAt: true
              },
              orderBy: {
                createdAt: 'desc'
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    })

    if (!project) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Project not found',
            projectId
          }, null, 2)
        }]
      }
    }

    // Calculate assignment stats
    const assignmentStats = {
      totalTasks: project.tasks.length,
      unassigned: project.tasks.filter(t => !t.assigneeId && !t.agentId).length,
      assignedToHumans: project.tasks.filter(t => t.assigneeId).length,
      assignedToAgents: project.tasks.filter(t => t.agentId).length,
      byStatus: {
        PENDING: project.tasks.filter(t => t.status === 'PENDING').length,
        IN_PROGRESS: project.tasks.filter(t => t.status === 'IN_PROGRESS').length,
        REVIEW: project.tasks.filter(t => t.status === 'REVIEW').length,
        COMPLETED: project.tasks.filter(t => t.status === 'COMPLETED').length,
        CANCELLED: project.tasks.filter(t => t.status === 'CANCELLED').length
      }
    }

    // Group tasks by assignee
    const tasksByAssignee = new Map()

    for (const task of project.tasks) {
      const assigneeKey = task.agentId
        ? `agent:${task.agentId}`
        : task.assigneeId
          ? `user:${task.assigneeId}`
          : 'unassigned'

      if (!tasksByAssignee.has(assigneeKey)) {
        tasksByAssignee.set(assigneeKey, {
          assignee: task.agent
            ? {
                type: 'AGENT',
                id: task.agent.id,
                name: task.agent.name,
                displayName: task.agent.displayName,
                agentType: task.agent.type
              }
            : task.assignee
              ? {
                  type: 'HUMAN',
                  id: task.assignee.id,
                  name: task.assignee.name,
                  email: task.assignee.email,
                  nickname: task.assignee.nickname
                }
              : null,
          tasks: []
        })
      }

      tasksByAssignee.get(assigneeKey).tasks.push({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        deliverables: task.deliverables
      })
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          project: {
            id: project.id,
            name: project.name,
            description: project.description,
            status: project.status,
            team: project.team
          },
          projectMembers: project.members.map(m => ({
            id: m.userId,
            name: m.user.name,
            email: m.user.email,
            nickname: m.user.nickname,
            avatar: m.user.avatar,
            role: m.role,
            joinedAt: m.joinedAt
          })),
          assignmentStats,
          assignments: Array.from(tasksByAssignee.values()),
          unassignedTasks: project.tasks
            .filter(t => !t.assigneeId && !t.agentId)
            .map(t => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueDate: t.dueDate
            }))
        }, null, 2)
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to get project team assignments',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, null, 2)
      }]
    }
  }
}
