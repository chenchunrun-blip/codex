# Email Testing Guide

## Current Status Checks

### 1. Console Output (Development)
If SMTP is not configured, this is expected:
- Emails are logged to console
- No real message is sent

### 2. Startup Logs
When SMTP is configured correctly, service startup should show readiness logs.

## Quick Test Scenarios

### Scenario A: Verification Email
1. Open `http://localhost:3002/settings`
2. Go to `Email Verification`
3. Click `Send Verification Email`
4. Check terminal logs or inbox

### Scenario B: Team Invitation
1. Create a team
2. Add another user
3. Check terminal logs or inbox

### Scenario C: Mention Notification
1. Open editor
2. Post a comment with `@username`
3. Check terminal logs or inbox

## SMTP Setup (Optional)

### Gmail (fast path)
1. Enable 2FA
2. Generate app password
3. Configure `.env`:

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="your-email@gmail.com"
```

4. Restart dev server

### 163 / QQ Mail
- Enable SMTP service in provider settings
- Use authorization code (not account password)
- Set corresponding host/port values

## Full Validation Flow

1. Verification email
2. Team invitation email
3. Mention notification email

Check either inbox (SMTP enabled) or server console (SMTP disabled).

## Common Issues

### "No email received"
- SMTP not configured
- invalid SMTP credentials
- message in spam folder
- provider throttling

### Gmail auth error
- app password not used
- 2FA not enabled
- wrong SMTP username

### Connection timeout
- wrong SMTP host/port/secure
- SMTP service not enabled at provider side

## Environment Guidance

### Development
- Prefer console output mode
- Faster debugging, no external dependency

### Production
- Use managed SMTP provider
- Monitor delivery and bounce rates

## Debug Tips

- Inspect raw email content in console mode
- Use Mailtrap for safe inbox testing
- Add temporary debug logs in `lib/email/service.ts` if needed

## Help Checklist

1. Confirm server logs
2. Verify SMTP `.env` values
3. Restart server after config change
4. Re-run the three test scenarios above
