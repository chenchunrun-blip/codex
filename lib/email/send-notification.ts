import { sendEmail, isEmailConfigured } from './service'
import {
  teamInvitationTemplate,
  projectInvitationTemplate,
  mentionNotificationTemplate,
  fileUpdateTemplate,
  projectUpdateTemplate,
  type TeamInvitationData,
  type ProjectInvitationData,
  type MentionData,
  type FileUpdateData,
  type ProjectUpdateData,
} from './templates'

const APP_NAME = process.env.APP_NAME || 'MarqDex'
const APP_URL = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3002'

/**
 * Send team invitation email
 */
export async function sendTeamInvitationEmail(
  toEmail: string,
  inviterName: string,
  inviterEmail: string,
  teamName: string,
  teamId: string
): Promise<void> {
  if (!isEmailConfigured()) return

  const data: TeamInvitationData = {
    appName: APP_NAME,
    appUrl: APP_URL,
    inviterName,
    inviterEmail,
    teamName,
    teamUrl: `${APP_URL}/teams/${teamId}`,
  }

  await sendEmail({
    to: toEmail,
    subject: `You've been added to ${teamName}`,
    html: teamInvitationTemplate(data),
  })
}

/**
 * Send project invitation email
 */
export async function sendProjectInvitationEmail(
  toEmail: string,
  inviterName: string,
  inviterEmail: string,
  projectName: string,
  teamName: string,
  projectId: string
): Promise<void> {
  if (!isEmailConfigured()) return

  const data: ProjectInvitationData = {
    appName: APP_NAME,
    appUrl: APP_URL,
    inviterName,
    inviterEmail,
    projectName,
    teamName,
    projectUrl: `${APP_URL}/projects/${projectId}`,
  }

  await sendEmail({
    to: toEmail,
    subject: `You've been added to ${projectName}`,
    html: projectInvitationTemplate(data),
  })
}

/**
 * Send mention notification email
 */
export async function sendMentionEmail(
  toEmail: string,
  commenterName: string,
  commenterEmail: string,
  fileName: string,
  projectName: string,
  commentContent: string,
  fileId: string
): Promise<void> {
  if (!isEmailConfigured()) return

  const data: MentionData = {
    appName: APP_NAME,
    appUrl: APP_URL,
    commenterName,
    commenterEmail,
    fileName,
    projectName,
    commentContent,
    fileUrl: `${APP_URL}/editor/${fileId}`,
  }

  await sendEmail({
    to: toEmail,
    subject: `${commenterName} mentioned you in a comment`,
    html: mentionNotificationTemplate(data),
  })
}

/**
 * Send file update notification email
 */
export async function sendFileUpdateEmail(
  toEmail: string,
  updaterName: string,
  updaterEmail: string,
  fileName: string,
  projectName: string,
  fileId: string
): Promise<void> {
  if (!isEmailConfigured()) return

  const data: FileUpdateData = {
    appName: APP_NAME,
    appUrl: APP_URL,
    updaterName,
    updaterEmail,
    fileName,
    projectName,
    fileUrl: `${APP_URL}/editor/${fileId}`,
  }

  await sendEmail({
    to: toEmail,
    subject: `${fileName} has been updated`,
    html: fileUpdateTemplate(data),
  })
}

/**
 * Send project update notification email
 */
export async function sendProjectUpdateEmail(
  toEmail: string,
  updaterName: string,
  updaterEmail: string,
  projectName: string,
  projectId: string
): Promise<void> {
  if (!isEmailConfigured()) return

  const data: ProjectUpdateData = {
    appName: APP_NAME,
    appUrl: APP_URL,
    updaterName,
    updaterEmail,
    projectName,
    projectUrl: `${APP_URL}/projects/${projectId}`,
  }

  await sendEmail({
    to: toEmail,
    subject: `${projectName} has been updated`,
    html: projectUpdateTemplate(data),
  })
}
