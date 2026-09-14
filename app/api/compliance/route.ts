import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { complianceViolations, dncPhones } from '@/lib/schema'
import { getBlockedStates, setRuntimeConfig } from '@/lib/config'
import { normalizeUsPhone } from '@/lib/leads'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const violations = await db
    .select()
    .from(complianceViolations)
    .where(eq(complianceViolations.shopId, user.shopId))
    .orderBy(desc(complianceViolations.createdAt))
    .limit(100)

  const dnc = await db
    .select()
    .from(dncPhones)
    .where(eq(dncPhones.shopId, user.shopId))
    .orderBy(desc(dncPhones.createdAt))
    .limit(200)

  return NextResponse.json({
    violations,
    dnc,
    stateBlocklist: getBlockedStates()
  })
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    phone?: string
    phoneDigits?: string
    reason?: string
    states?: string
  }

  if (body.action === 'dnc_add') {
    const normalized = normalizeUsPhone(String(body.phone || ''))
    const digits = normalized.ok
      ? normalized.digits
      : String(body.phoneDigits || '').replace(/\D/g, '').slice(-10)
    if (!digits) return NextResponse.json({ error: 'Valid phone required' }, { status: 400 })
    await db
      .insert(dncPhones)
      .values({
        shopId: user.shopId,
        phoneDigits: digits,
        reason: body.reason || 'Manual compliance add',
        createdAt: Date.now()
      })
      .onConflictDoNothing()
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'dnc_remove') {
    const digits = String(body.phoneDigits || '').replace(/\D/g, '').slice(-10)
    if (!digits) return NextResponse.json({ error: 'phoneDigits required' }, { status: 400 })
    await db
      .delete(dncPhones)
      .where(and(eq(dncPhones.shopId, user.shopId), eq(dncPhones.phoneDigits, digits)))
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_blocklist') {
    const states = String(body.states || '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .join(',')
    setRuntimeConfig({ US_STATE_BLOCKLIST: states })
    // Persist hint file for local/dev (no DB).
    const dir = join(process.cwd(), 'prompts')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.state-blocklist'), states, 'utf8')
    return NextResponse.json({ ok: true, states: states ? states.split(',') : [] })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
