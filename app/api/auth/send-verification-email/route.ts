import { requireAuth } from "@/lib/auth/rbac"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { sendEmail } from "@/lib/email/service"
import { baseTemplate } from "@/lib/email/templates"

export async function POST(req: Request) {
  try {
    const session = await requireAuth()

    if (!session.user?.id) {
      return NextResponse.json(
        { error: "User not authenticated", code: "UNAUTHORIZED" },
        { status: 401 }
      )
    }

    // Check if email is already verified
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { emailVerified: true, email: true, name: true }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found", code: "USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { error: "Email is already verified", code: "EMAIL_ALREADY_VERIFIED" },
        { status: 400 }
      )
    }

    // Generate verification token
    const token = randomBytes(32).toString("hex")
    const identifier = user.email!

    // Delete any existing tokens for this user
    await db.verificationToken.deleteMany({
      where: { identifier }
    })

    // Create new verification token (expires in 24 hours)
    const expires = new Date()
    expires.setHours(expires.getHours() + 24)

    await db.verificationToken.create({
      data: {
        identifier,
        token,
        expires
      }
    })

    // Send verification email
    const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3002'
    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${token}`

    const content = `
      <h2>📧 Verify Your Email Address</h2>
      <p>Hi ${user.name || 'there'},</p>
      <p>Thank you for registering! Please verify your email address by clicking the button below:</p>
      <p>
        <a href="${verificationUrl}" class="button">Verify Email</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #2563eb;">${verificationUrl}</p>
      <p><strong>This link will expire in 24 hours.</strong></p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `

    await sendEmail({
      to: user.email,
      subject: "Verify Your Email Address",
      html: baseTemplate(content, "MarqDex", appUrl)
    })

    return NextResponse.json({ success: true, message: "Verification email sent" })
  } catch (error) {
    console.error("Failed to send verification email:", error)
    return NextResponse.json(
      { error: "Failed to send verification email", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
