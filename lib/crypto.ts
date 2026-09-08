import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto'

const ENCODING = 'base64url'

function key(): Buffer | null {
  const raw = process.env.GARAGEOS_SECRET_KEY
  if (!raw) return null
  const buf = Buffer.from(raw, ENCODING)
  if (buf.length !== 32 && buf.length !== 24 && buf.length !== 16) {
    const hashed = createHash('sha256').update(raw).digest()
    return hashed.subarray(0, 32)
  }
  return buf
}

const PREFIX = 'enc:'

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(plain: string): string {
  const text = String(plain || '')
  if (!text) return ''
  const k = key()
  if (!k) return text
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString(ENCODING)}.${tag.toString(ENCODING)}.${enc.toString(ENCODING)}`
}

export function decryptSecret(stored: string): string {
  const value = String(stored || '')
  if (!value) return ''
  if (!isEncrypted(value)) return value
  const k = key()
  if (!k) return ''
  const body = value.slice(PREFIX.length)
  const parts = body.split('.')
  if (parts.length !== 3) return ''
  try {
    const iv = Buffer.from(parts[0], ENCODING)
    const tag = Buffer.from(parts[1], ENCODING)
    const enc = Buffer.from(parts[2], ENCODING)
    const decipher = createDecipheriv('aes-256-gcm', k, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return ''
  }
}

export function maskSecret(stored: string): string {
  const value = decryptSecret(stored)
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
