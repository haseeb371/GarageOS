import 'server-only'
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoAppointments, salesLeads } from '@/lib/schema'
import { getConfig } from '@/lib/config'
import { normalizeUsPhone } from '@/lib/leads'

export const DEMO_DURATION_MS = 15 * 60 * 1000
export const SALES_TIMEZONE = process.env.SALES_TZ?.trim() || 'America/Chicago'

/** Weekday hours local to SALES_TIMEZONE — morning + afternoon blocks. */
const SLOT_HOURS = [9, 10, 11, 13, 14, 15]

function salesShopId() {
  return getConfig().LEADS_IMPORT_SHOP_ID || ''
}

/** Format a UTC ms instant in the sales timezone for speech / UI. */
export function formatDemoSlot(ms: number, timeZone = SALES_TIMEZONE) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(ms))
}

function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: get('weekday'),
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute'))
  }
}

/** Approximate UTC ms for a local wall time in `timeZone` (good enough for US zones). */
function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const asLocal = zonedParts(utcGuess, timeZone)
  const desiredAsMin = hour * 60 + minute
  const actualAsMin = asLocal.hour * 60 + asLocal.minute
  return utcGuess + (desiredAsMin - actualAsMin) * 60_000
}

export type DemoSlot = { startsAt: number; endsAt: number; label: string }

export async function listDemoSlots(options?: {
  shopId?: string
  days?: number
  limit?: number
}): Promise<DemoSlot[]> {
  const shopId = options?.shopId || salesShopId()
  const days = options?.days ?? 10
  const limit = options?.limit ?? 12
  const timeZone = SALES_TIMEZONE
  const now = Date.now()
  const horizonEnd = now + days * 24 * 60 * 60 * 1000

  const existing = shopId
    ? await db
        .select({ startsAt: demoAppointments.startsAt, endsAt: demoAppointments.endsAt })
        .from(demoAppointments)
        .where(
          and(
            eq(demoAppointments.shopId, shopId),
            ne(demoAppointments.status, 'cancelled'),
            gte(demoAppointments.startsAt, now - DEMO_DURATION_MS),
            lt(demoAppointments.startsAt, horizonEnd)
          )
        )
    : []

  const taken = new Set(existing.map(r => r.startsAt))
  const slots: DemoSlot[] = []
  const startDay = new Date(now)
  for (let d = 0; d < days + 2 && slots.length < limit; d++) {
    const probe = now + d * 24 * 60 * 60 * 1000
    const local = zonedParts(probe, timeZone)
    if (local.weekday === 'Sat' || local.weekday === 'Sun') continue
    for (const hour of SLOT_HOURS) {
      const startsAt = wallTimeToUtc(local.year, local.month, local.day, hour, 0, timeZone)
      if (startsAt < now + 30 * 60 * 1000) continue
      if (taken.has(startsAt)) continue
      slots.push({
        startsAt,
        endsAt: startsAt + DEMO_DURATION_MS,
        label: formatDemoSlot(startsAt, timeZone)
      })
      if (slots.length >= limit) break
    }
  }
  return slots
}

export async function bookDemoAppointment(input: {
  shopId?: string
  leadId?: string | null
  businessName?: string
  contactName?: string
  phone?: string
  email?: string
  startsAt: number
  source?: string
  notes?: string
}) {
  const shopId = input.shopId || salesShopId()
  if (!shopId) return { ok: false as const, error: 'Sales shop is not configured (LEADS_IMPORT_SHOP_ID).' }
  if (!Number.isFinite(input.startsAt) || input.startsAt < Date.now()) {
    return { ok: false as const, error: 'Pick a future demo time.' }
  }

  const open = await listDemoSlots({ shopId, days: 14, limit: 40 })
  const match = open.find(s => s.startsAt === input.startsAt)
  if (!match) {
    return { ok: false as const, error: 'That slot is no longer available. Offer two other times.' }
  }

  const now = Date.now()
  const id = `DEMO-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  let leadId = input.leadId || null

  const phoneRaw = (input.phone || '').trim()
  if (!leadId && phoneRaw) {
    const normalized = normalizeUsPhone(phoneRaw)
    if (normalized.ok) {
      const [existing] = await db
        .select()
        .from(salesLeads)
        .where(and(eq(salesLeads.shopId, shopId), eq(salesLeads.phoneDigits, normalized.digits)))
        .limit(1)
      if (existing) {
        leadId = existing.id
      } else {
        leadId = `LEAD-DEMO-${normalized.digits}-${now}`
        await db.insert(salesLeads).values({
          id: leadId,
          shopId,
          businessName: input.businessName || input.contactName || 'Demo booking',
          phone: normalized.formatted,
          phoneDigits: normalized.digits,
          address: '',
          website: null,
          rating: null,
          reviewCount: null,
          placeId: `demo-${normalized.digits}`,
          source: input.source || 'demo_booking',
          campaign: '',
          status: 'interested',
          notes: `Demo booked for ${formatDemoSlot(match.startsAt)}`,
          attempts: 0,
          retryAfter: null,
          createdAt: now,
          lastContactedAt: now,
          updatedAt: now
        })
      }
    }
  }

  if (leadId) {
    await db
      .update(salesLeads)
      .set({
        status: 'interested',
        notes: `Demo booked: ${formatDemoSlot(match.startsAt)}`,
        updatedAt: now
      })
      .where(and(eq(salesLeads.id, leadId), eq(salesLeads.shopId, shopId)))
  }

  await db.insert(demoAppointments).values({
    id,
    shopId,
    leadId,
    businessName: input.businessName || '',
    contactName: input.contactName || '',
    phone: phoneRaw,
    email: (input.email || '').trim(),
    startsAt: match.startsAt,
    endsAt: match.endsAt,
    timezone: SALES_TIMEZONE,
    status: 'scheduled',
    source: input.source || 'web',
    notes: input.notes || '',
    createdAt: now,
    updatedAt: now
  })

  return {
    ok: true as const,
    id,
    leadId,
    startsAt: match.startsAt,
    endsAt: match.endsAt,
    label: match.label,
    message: `Booked 15-minute demo for ${match.label}. We'll call or meet you then.`
  }
}

export async function listUpcomingDemos(shopId: string, limit = 30) {
  const now = Date.now() - 60 * 60 * 1000
  return db
    .select()
    .from(demoAppointments)
    .where(
      and(
        eq(demoAppointments.shopId, shopId),
        ne(demoAppointments.status, 'cancelled'),
        gte(demoAppointments.startsAt, now)
      )
    )
    .orderBy(asc(demoAppointments.startsAt))
    .limit(limit)
}
