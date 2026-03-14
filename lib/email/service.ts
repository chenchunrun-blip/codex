import nodemailer from 'nodemailer'

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// Verify email configuration on startup
if (process.env.SMTP_HOST) {
  transporter.verify((error, success) => {
    if (error) {
      console.error('Email service configuration error:', error)
    } else {
      console.log('Email service is ready')
    }
  })
}

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Send an email
 */
export async function sendEmail({ to, subject, html, text }: EmailOptions): Promise<boolean> {
  try {
    // If SMTP is not configured, just log and return success
    if (!process.env.SMTP_HOST) {
      console.log('[Email Service] SMTP not configured. Email would be sent:')
      console.log(`To: ${to}`)
      console.log(`Subject: ${subject}`)
      console.log(`HTML: ${html.substring(0, 200)}...`)
      return true
    }

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"MarqDex" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
    })

    console.log('Email sent:', info.messageId)
    return true
  } catch (error) {
    console.error('Failed to send email:', error)
    return false
  }
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST
}
