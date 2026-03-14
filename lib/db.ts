import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }

  // Only initialize if DATABASE_URL is available
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const adapter = new PrismaPg(pool as any)
  const client = new PrismaClient({
    adapter,
  })

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client
  }

  return client
}

// Lazy initialization - only create client when actually used
export const db = getPrismaClient()
