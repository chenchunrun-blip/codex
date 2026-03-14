import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { NextResponse } from "next/server"
import { hash } from "bcryptjs"

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json().catch(() => ({}))

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required", code: "INVALID_REQUEST_PAYLOAD" },
        { status: 400 }
      )
    }

    const existing = await db.user.findUnique({
      where: { email }
    })

    if (existing) {
      return NextResponse.json(
        { error: "User already exists", code: "USER_ALREADY_EXISTS" },
        { status: 400 }
      )
    }

    const hashedPassword = await hash(password, 10)

    const user = await db.user.create({
      data: {
        email,
        password: hashedPassword,
        name
      }
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    })
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json(
      { error: "Registration failed", code: "INTERNAL_ERROR" },
      { status: 500 }
    )
  }
}
