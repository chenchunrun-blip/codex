import { db } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        { error: "Verification token is required", code: "INVALID_QUERY_PARAMETERS" },
        { status: 400 }
      )
    }

    // Find verification token
    const verificationToken = await db.verificationToken.findUnique({
      where: { token }
    })

    if (!verificationToken) {
      return NextResponse.json(
        { error: "Invalid verification token", code: "INVALID_VERIFICATION_TOKEN" },
        { status: 400 }
      )
    }

    // Check if token has expired
    if (verificationToken.expires < new Date()) {
      // Delete expired token
      await db.verificationToken.delete({
        where: { token }
      })

      return NextResponse.json(
        {
          error: "Verification token has expired. Please request a new one.",
          code: "VERIFICATION_TOKEN_EXPIRED"
        },
        { status: 400 }
      )
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: verificationToken.identifier }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found", code: "USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    // Update user email verified status
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true }
    })

    // Delete verification token
    await db.verificationToken.delete({
      where: { token }
    })

    // Redirect to success page or login with success message
    const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3002'
    return NextResponse.redirect(`${appUrl}/login?verified=true`)
  } catch (error) {
    console.error("Email verification error:", error)
    return NextResponse.json(
      { error: "Failed to verify email", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
