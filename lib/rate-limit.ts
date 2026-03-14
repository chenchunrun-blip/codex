/**
 * Rate Limiting Utility
 *
 * Simple in-memory rate limiting for API routes.
 * For production, consider using Redis-backed rate limiting.
 */

interface RateLimitRecord {
  count: number
  resetTime: number
}

// In-memory store for rate limiting
// Note: This will reset on server restart
const rateLimitStore = new Map<string, RateLimitRecord>()

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}, 5 * 60 * 1000)

export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number
  /** Maximum requests per window */
  maxRequests: number
  /** Key prefix for namespacing */
  keyPrefix?: string
}

export interface RateLimitResult {
  success: boolean
  remaining: number
  resetTime: number
  retryAfter?: number
}

/**
 * Check rate limit for a given identifier
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result with remaining requests
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${config.keyPrefix || 'default'}:${identifier}`
  const now = Date.now()

  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    // Create new record
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs
    })

    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs
    }
  }

  if (record.count >= config.maxRequests) {
    // Rate limit exceeded
    return {
      success: false,
      remaining: 0,
      resetTime: record.resetTime,
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    }
  }

  // Increment count
  record.count++

  return {
    success: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime
  }
}

/**
 * Reset rate limit for a given identifier
 */
export function resetRateLimit(identifier: string, keyPrefix?: string): void {
  const key = `${keyPrefix || 'default'}:${identifier}`
  rateLimitStore.delete(key)
}

/**
 * Pre-configured rate limiters
 */
export const rateLimiters = {
  /** Auth endpoints: 5 requests per 15 minutes */
  auth: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'auth'
  },

  /** API endpoints: 100 requests per minute */
  api: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'api'
  },

  /** AI generation: 20 requests per minute */
  ai: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyPrefix: 'ai'
  },

  /** MCP endpoints: 60 requests per minute */
  mcp: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    keyPrefix: 'mcp'
  },

  /** File operations: 30 requests per minute */
  file: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'file'
  }
} as const

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback for development
  return 'unknown'
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000))
  }

  if (result.retryAfter) {
    headers['Retry-After'] = String(result.retryAfter)
  }

  return headers
}
