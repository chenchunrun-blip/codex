/**
 * Check if user should receive email based on their preferences
 * @param userId - User ID to check
 * @param emailType - Type of email (mentions, teamInvites, projectInvites, fileUpdates, projectUpdates)
 * @returns Promise<boolean> - true if user should receive this type of email
 */
export async function shouldSendEmail(userId: string, emailType: string): Promise<boolean> {
  try {
    // This would check database or user preferences
    // For now, we'll implement a simple check that can be enhanced later

    // You can extend this to:
    // 1. Check user.emailEnabled field in database
    // 2. Check per-user email preferences stored in database
    // 3. Check user's notification preferences

    return true // Default to sending emails
  } catch (error) {
    console.error('Error checking email preference:', error)
    return true // Default to sending on error
  }
}

/**
 * Email type constants
 */
export const EmailTypes = {
  MENTIONS: 'mentions',
  TEAM_INVITES: 'teamInvites',
  PROJECT_INVITES: 'projectInvites',
  FILE_UPDATES: 'fileUpdates',
  PROJECT_UPDATES: 'projectUpdates'
} as const
