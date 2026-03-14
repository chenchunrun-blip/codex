export interface TemplateData {
  appName: string
  appUrl: string
}

export interface TeamInvitationData extends TemplateData {
  inviterName: string
  inviterEmail: string
  teamName: string
  teamUrl: string
}

export interface ProjectInvitationData extends TemplateData {
  inviterName: string
  inviterEmail: string
  projectName: string
  teamName: string
  projectUrl: string
}

export interface MentionData extends TemplateData {
  commenterName: string
  commenterEmail: string
  fileName: string
  projectName: string
  commentContent: string
  fileUrl: string
}

export interface FileUpdateData extends TemplateData {
  updaterName: string
  updaterEmail: string
  fileName: string
  projectName: string
  fileUrl: string
}

export interface ProjectUpdateData extends TemplateData {
  updaterName: string
  updaterEmail: string
  projectName: string
  projectUrl: string
}

/**
 * Base email template with header and footer
 */
export function baseTemplate(content: string, appName: string, appUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #2563eb;
    }
    .content {
      margin-bottom: 24px;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #2563eb;
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin: 16px 0;
    }
    .button:hover {
      background-color: #1d4ed8;
    }
    .footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 20px;
      margin-top: 24px;
      font-size: 14px;
      color: #6b7280;
    }
    .footer a {
      color: #2563eb;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">${appName}</div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>You're receiving this email because you're a member of ${appName}.</p>
      <p>© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `
}

/**
 * Team invitation email template
 */
export function teamInvitationTemplate(data: TeamInvitationData): string {
  const content = `
    <h2>🎉 You've been added to a team!</h2>
    <p>Hi,</p>
    <p><strong>${data.inviterName}</strong> (${data.inviterEmail}) has added you to the team <strong>${data.teamName}</strong>.</p>
    <p>You can now collaborate with your team members on projects and documents.</p>
    <p>
      <a href="${data.teamUrl}" class="button">View Team</a>
    </p>
    <p>If you have any questions, feel free to reach out to the team administrator.</p>
  `

  return baseTemplate(content, data.appName, data.appUrl)
}

/**
 * Project invitation email template
 */
export function projectInvitationTemplate(data: ProjectInvitationData): string {
  const content = `
    <h2>🎉 You've been added to a project!</h2>
    <p>Hi,</p>
    <p><strong>${data.inviterName}</strong> (${data.inviterEmail}) has added you to the project <strong>${data.projectName}</strong> in the <strong>${data.teamName}</strong> team.</p>
    <p>You can now collaborate on documents and track progress together.</p>
    <p>
      <a href="${data.projectUrl}" class="button">View Project</a>
    </p>
    <p>If you have any questions, feel free to reach out to the project administrator.</p>
  `

  return baseTemplate(content, data.appName, data.appUrl)
}

/**
 * Mention notification email template
 */
export function mentionNotificationTemplate(data: MentionData): string {
  const content = `
    <h2>💬 You were mentioned in a comment</h2>
    <p>Hi,</p>
    <p><strong>${data.commenterName}</strong> (${data.commenterEmail}) mentioned you in a comment on <strong>${data.fileName}</strong>.</p>
    <p><strong>Project:</strong> ${data.projectName}</p>
    <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0; color: #4b5563;">"${data.commentContent.substring(0, 200)}${data.commentContent.length > 200 ? '...' : ''}"</p>
    </div>
    <p>
      <a href="${data.fileUrl}" class="button">View Comment</a>
    </p>
  `

  return baseTemplate(content, data.appName, data.appUrl)
}

/**
 * File update notification email template
 */
export function fileUpdateTemplate(data: FileUpdateData): string {
  const content = `
    <h2>📄 A file has been updated</h2>
    <p>Hi,</p>
    <p><strong>${data.updaterName}</strong> (${data.updaterEmail}) has updated the file <strong>${data.fileName}</strong> in the project <strong>${data.projectName}</strong>.</p>
    <p>
      <a href="${data.fileUrl}" class="button">View File</a>
    </p>
  `

  return baseTemplate(content, data.appName, data.appUrl)
}

/**
 * Project update notification email template
 */
export function projectUpdateTemplate(data: ProjectUpdateData): string {
  const content = `
    <h2>⚙️ Project information has been updated</h2>
    <p>Hi,</p>
    <p><strong>${data.updaterName}</strong> (${data.updaterEmail}) has updated the project <strong>${data.projectName}</strong>.</p>
    <p>Check the project page to see what's changed.</p>
    <p>
      <a href="${data.projectUrl}" class="button">View Project</a>
    </p>
  `

  return baseTemplate(content, data.appName, data.appUrl)
}
