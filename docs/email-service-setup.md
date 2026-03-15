# Email Service Configuration Guide

## Overview

The MarqDex Work System includes a comprehensive email notification service that sends emails for important events such as:
- Team invitations
- Project invitations
- @mentions in comments
- File updates
- Project updates

## Email Service Features

### Supported Email Types
1. **Team Invitations** - When a user is added to a team
2. **Project Invitations** - When a user is added to a project
3. **Mentions** - When someone is @mentioned in a comment
4. **File Updates** - When a file is updated by another user
5. **Project Updates** - When project information is changed

### Email Templates
All emails use professional HTML templates with:
- Responsive design
- Brand consistency
- Clear call-to-action buttons
- Proper email headers and footers

## Configuration

### Environment Variables

Add the following variables to your `.env` file:

```bash
# SMTP Configuration (Required for email sending)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="MarqDex <your-email@gmail.com>"

# App Configuration
APP_NAME=MarqDex
APP_URL=http://localhost:3002
```

### SMTP Service Providers

#### Gmail (Recommended for Development)
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

**Note**: For Gmail, you need to use an App Password instead of your regular password:
1. Go to Google Account settings
2. Enable 2-Step Verification
3. Generate an App Password
4. Use the App Password in `SMTP_PASS`

#### SendGrid (Recommended for Production)
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=YOUR_SENDGRID_API_KEY
```

#### Amazon SES (Cost-effective for Production)
```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=YOUR_SES_SMTP_USERNAME
SMTP_PASS=YOUR_SES_SMTP_PASSWORD
```

#### Mailgun
```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=YOUR_MAILGUN_USERNAME
SMTP_PASS=YOUR_MAILGUN_PASSWORD
```

#### Outlook/Office 365
```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

## Development Mode

If SMTP is not configured, the system will log emails to the console instead of sending them:

```
[Email Service] SMTP not configured. Email would be sent:
To: user@example.com
Subject: You've been added to Team Name
HTML: <!DOCTYPE html>...
```

This allows you to test the email functionality without setting up an SMTP server.

## Testing Email Service

### 1. Verify Configuration

Start your development server and check the logs:

```
Email service is ready
```

If you see an error, check your SMTP configuration.

### 2. Test Email Sending

1. Create a test team
2. Add a member to the team
3. Check the console (development) or email inbox (production)

### 3. View Email Logs

All email send attempts are logged:
- Success: `Email sent: <message-id>`
- Failure: `Failed to send email: <error>`

## Email Templates

### Team Invitation Template
- Subject: "You've been added to {teamName}"
- Content: Inviter info, team name, call-to-action button

### Project Invitation Template
- Subject: "You've been added to {projectName}"
- Content: Inviter info, project name, team name, call-to-action button

### Mention Notification Template
- Subject: "{commenterName} mentioned you in a comment"
- Content: Commenter info, file name, project name, comment preview

### File Update Template
- Subject: "{fileName} has been updated"
- Content: Updater info, file name, project name, call-to-action button

### Project Update Template
- Subject: "{projectName} has been updated"
- Content: Updater info, project name, call-to-action button

## Customization

### Modify Email Templates

Edit the template functions in `lib/email/templates.ts`:

```typescript
export function teamInvitationTemplate(data: TeamInvitationData): string {
  const content = `
    <h2>🎉 You've been added to a team!</h2>
    <p>Hi,</p>
    <p><strong>${data.inviterName}</strong> (${data.inviterEmail}) has added you to the team <strong>${data.teamName}</strong>.</p>
    <!-- Customize your content here -->
  `
  return baseTemplate(content, data.appName, data.appUrl)
}
```

### Modify Email Styles

Edit the CSS in the `baseTemplate` function in `lib/email/templates.ts` to customize:
- Colors
- Fonts
- Layout
- Button styles

### Add New Email Type

1. Create template function in `lib/email/templates.ts`
2. Create sender function in `lib/email/send-notification.ts`
3. Call the sender function in your API route

## Troubleshooting

### Emails Not Sending

1. **Check SMTP Configuration**: Verify all SMTP environment variables are set
2. **Check Credentials**: Ensure username/password are correct
3. **Check Firewall**: Ensure port 587 is not blocked
4. **Check SMTP Provider Logs**: Some providers (SendGrid, Mailgun) have dashboards

### Gmail Authentication Errors

- Enable 2-Step Verification
- Use App Password, not regular password
- Check "Less secure app access" is enabled (deprecated)

### Emails Going to Spam

1. **Set up SPF/DKIM records** in your DNS
2. **Use a dedicated email service** (SendGrid, Mailgun, SES)
3. **Check email content** for spam trigger words
4. **Verify sender domain** with your SMTP provider

### Rate Limiting

- Gmail: 500 emails/day
- SendGrid: Depends on plan
- Amazon SES: Starts at 1 email/second

For high-volume sending, use a dedicated email service provider.

## Production Recommendations

1. **Use a Dedicated Email Service**
   - SendGrid (reliable, good free tier)
   - Amazon SES (cost-effective for high volume)
   - Mailgun (good for developers)
   - Postmark (excellent deliverability)

2. **Set Up Email Monitoring**
   - Track delivery rates
   - Monitor bounce rates
   - Set up alerts for failures

3. **Implement Email Queueing** (Future)
   - Use a job queue (Bull, BullMQ)
   - Process emails asynchronously
   - Handle failures gracefully

4. **Configure DNS Records**
   - SPF: Verify sending servers
   - DKIM: Sign emails cryptographically
   - DMARC: Policy for handling failed emails

## Security Best Practices

1. **Never commit SMTP credentials to git**
2. **Use environment variables** for all credentials
3. **Use App Passwords** instead of regular passwords
4. **Rotate credentials regularly**
5. **Monitor email usage** for unusual activity
6. **Implement rate limiting** on email sending

## Future Enhancements

- [ ] Email preferences per user
- [ ] Email digest (daily/weekly summaries)
- [ ] Unsubscribe links
- [ ] Email queue system
- [ ] Attachment support
- [ ] Rich text email content
- [ ] Email analytics and tracking
