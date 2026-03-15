# Email Features Guide

## Frontend Features

### 1. Email Verification
Location: `Settings -> Email Verification`

Capabilities:
- Show current verification status
- Send verification email
- Verification link expires in 24 hours

Use cases:
- Send verification after registration
- Resend verification from settings

### 2. Email Preferences
Location: `Settings -> Email Preferences`

Capabilities:
- Global switch for all email notifications
- Per-category switches:
  - `@Mentions`
  - `Team Invitations`
  - `Project Invitations`
  - `File Updates`
  - `Project Updates`

Use cases:
- Reduce notification noise
- Keep only high-priority notifications

## Notification Flows

### Team Invitation Email
Trigger: adding a user to a team  
Recipient: invited user  
Content includes inviter, team name, team link.

### Project Invitation Email
Trigger: adding a user to a project  
Recipient: invited user  
Content includes inviter, project name, team name, project link.

### Mention Email
Trigger: `@username` in comments  
Recipient: mentioned user  
Content includes actor, file/project context, comment preview, editor link.

### File Update Email
Trigger: file content update  
Recipient: other project members  
Content includes updater, file name, project, editor link.

### Project Update Email
Trigger: project metadata update  
Recipient: other project members  
Content includes updater, project name, project link.

## Configuration

### Development
Option A (recommended): no SMTP config. Emails are printed to console.  
Option B: configure SMTP for end-to-end testing.

### Production
Recommended providers:
- SendGrid
- Amazon SES
- Mailgun
- Postmark

Use environment variables only; do not hardcode credentials.

## Templates

Template source: `lib/email/templates.ts`.

Core templates:
- `teamInvitationTemplate`
- `projectInvitationTemplate`
- `mentionNotificationTemplate`
- `fileUpdateTemplate`
- `projectUpdateTemplate`

## Troubleshooting

### No emails received
Check:
- SMTP is configured (or verify console output in dev)
- credentials are valid
- spam folder
- provider rate limits

### Gmail auth failure
- Use an app password, not account password
- Ensure 2FA is enabled

### SMTP timeout
- Verify SMTP service is enabled
- verify host/port/secure configuration

## Best Practices

- Dev: use console mode for rapid debugging
- Prod: use a managed provider and monitor delivery success
- Rotate SMTP credentials regularly
- Audit abnormal send patterns

## Planned Enhancements

- Unsubscribe links
- Daily/weekly digest
- Email history
- Open/click tracking
