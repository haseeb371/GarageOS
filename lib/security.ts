import 'server-only'
import { headers } from 'next/headers'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10000

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  prune(now)
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs }
    buckets.set(key, fresh)
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt }
  }
  if (b.count >= limit) return { ok: false, remaining: 0, resetAt: b.resetAt }
  b.count += 1
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt }
}

export async function clientIp(): Promise<string> {
  const h = await headers()
  return String(
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  )
}

export async function rateLimitByIp(action: string, limit: number, windowMs: number) {
  const ip = await clientIp()
  return rateLimit(`${action}:${ip}`, limit, windowMs)
}
