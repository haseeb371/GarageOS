import 'server-only'
import { createHash, randomInt } from 'crypto'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { db } from './db'
import { authCodes } from './schema'

const CODE_TTL = 10 * 60 * 1000

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex')
}

export function generateCode(): string {
  return String(randomInt(100000, 999999))
}

export async function storeCode(email: string, purpose: string): Promise<string | null> {
  const code = generateCode()
  const now = Date.now()
  try {
    await db.insert(authCodes).values({
      email: email.toLowerCase(),
      codeHash: hashCode(code),
      purpose,
      expiresAt: now + CODE_TTL,
      consumedAt: null,
      createdAt: now
    })
    return code
  } catch {
    return null
  }
}

export async function verifyCode(email: string, purpose: string, code: string): Promise<boolean> {
  const now = Date.now()
  const rows = await db
    .select()
    .from(authCodes)
    .where(and(
      eq(authCodes.email, email.toLowerCase()),
      eq(authCodes.purpose, purpose),
      eq(authCodes.codeHash, hashCode(code)),
      gt(authCodes.expiresAt, now),
      isNull(authCodes.consumedAt)
    ))
    .limit(1)

  if (!rows.length) return false

  await db
    .update(authCodes)
    .set({ consumedAt: now })
    .where(eq(authCodes.id, rows[0].id))

  return true
}

export async function cleanupExpiredCodes() {
  const now = Date.now()
  await db.delete(authCodes).where(lt(authCodes.expiresAt, now))
}
