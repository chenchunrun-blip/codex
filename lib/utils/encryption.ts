import { scryptSync, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto'

// Cache the encryption key to avoid repeated derivation
let cachedKey: Buffer | null = null

/**
 * Get encryption key derived from environment variable
 * Uses a configurable salt for per-deployment uniqueness
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) {
    return cachedKey
  }

  const keyString = process.env.ENCRYPTION_KEY

  if (!keyString) {
    throw new Error('ENCRYPTION_KEY environment variable must be set')
  }

  if (keyString.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters long')
  }

  // Use configurable salt for per-deployment uniqueness
  // Falls back to a default salt (should be changed in production)
  const saltString = process.env.ENCRYPTION_SALT || 'marqdex-default-salt-change-in-production'

  if (saltString.length < 16) {
    throw new Error('ENCRYPTION_SALT must be at least 16 characters long')
  }

  const salt = Buffer.from(saltString, 'utf-8')
  cachedKey = scryptSync(keyString, salt, 32)

  return cachedKey
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - The text to encrypt
 * @returns String in format iv:authTag:encrypted (all hex encoded)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty plaintext')
  }

  try {
    const key = getEncryptionKey()
    const iv = randomBytes(16) // 16 bytes IV for GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv)

    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()

    // Return format: iv:authTag:encrypted (all hex encoded)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
  } catch (error) {
    // Log error but don't expose details
    console.error('Encryption error occurred')
    throw new Error('Failed to encrypt data')
  }
}

/**
 * Decrypt ciphertext that was encrypted with encrypt()
 * @param ciphertext - The encrypted string in format iv:authTag:encrypted
 * @returns The decrypted plaintext
 * @throws Error if decryption fails (data corrupted or tampered)
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return ''
  }

  const parts = ciphertext.split(':')

  // Check for new format (iv:authTag:encrypted)
  if (parts.length === 3) {
    try {
      const [ivHex, authTagHex, encrypted] = parts

      // Validate format
      if (ivHex.length !== 32 || authTagHex.length !== 32) {
        throw new Error('Invalid encrypted data format')
      }

      const iv = Buffer.from(ivHex, 'hex')
      const authTag = Buffer.from(authTagHex, 'hex')

      const key = getEncryptionKey()
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      // Log error details server-side only
      console.error('Decryption failed - data may be corrupted or tampered')
      throw new Error('Failed to decrypt data - data may be corrupted or tampered')
    }
  }

  // Legacy format support (base64) - for migration only
  // This will be removed after all data is migrated
  console.warn('Warning: Using legacy decryption format - please re-encrypt data')
  try {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf-8')
    if (!decoded) {
      throw new Error('Legacy decryption returned empty result')
    }
    return decoded
  } catch {
    throw new Error('Failed to decrypt data - invalid format')
  }
}

/**
 * Check if a string is encrypted (in our format)
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false
  const parts = value.split(':')
  return parts.length === 3 &&
    parts[0].length === 32 && // IV is 16 bytes = 32 hex chars
    parts[1].length === 32 && // AuthTag is 16 bytes = 32 hex chars
    parts[2].length > 0 && parts[2].length % 2 === 0 // Encrypted data (even length hex)
}

/**
 * Timing-safe string comparison
 * Use this for comparing API keys or other secrets
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/**
 * Clear the cached encryption key (for testing)
 */
export function clearKeyCache(): void {
  cachedKey = null
}
