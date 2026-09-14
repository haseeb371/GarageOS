import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { contactLogs, dncPhones, salesLeads } from '@/lib/schema'
import { e164FromStoredPhone, isCallableStatus } from '@/lib/leads'
import { evaluateDialerLead, isDialerEnabled, trackDialStart } from '@/lib/dialerGuards'
import { placeOutboundCall, telnyxConfigured } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner, Manager, or Advisor can place lead calls.' }, { status: 403 })
  }

  if (!isDialerEnabled()) {
    console.log('[call-now] DIALER_ENABLED=false — outbound no-op')
    return NextResponse.json(
      {
        error:
          'DIALER_ENABLED=false. Outbound AI calling is disabled until you flip the env flag after legal review.'
      },
      { status: 403 }
    )
  }

  const { id } = await ctx.params
  const [lead] = await db
    .select()
    .from(salesLeads)
    .where(and(eq(salesLeads.id, id), eq(salesLeads.shopId, user.shopId)))
    .limit(1)

  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  if (!isCallableStatus(lead.status)) {
    return NextResponse.json({ error: 'This lead is marked Do Not Call. Calling is blocked.' }, { status: 403 })
  }

  const dncRows = await db.select().from(dncPhones).where(eq(dncPhones.shopId, user.shopId))
  const dncDigits = new Set(dncRows.map(r => r.phoneDigits))
  const check = evaluateDialerLead(
    {
      id: lead.id,
      status: lead.status,
      phoneDigits: lead.phoneDigits,
      address: lead.address,
      lastContactedAt: lead.lastContactedAt,
      retryAfter: lead.retryAfter,
      attempts: lead.attempts
    },
    { dncDigits }
  )
  if (!check.ok) {
    return NextResponse.json({ error: `Call blocked: ${check.reason}` }, { status: 403 })
  }

  if (!telnyxConfigured()) {
    return NextResponse.json(
      { error: 'Telnyx is not configured (TELNYX_API_KEY, CONNECTION_ID, FROM_NUMBER).' },
      { status: 503 }
    )
  }

  const to = e164FromStoredPhone(lead.phone)
  const placed = await placeOutboundCall(to, lead.id, user.shopId, lead.campaign)
  const now = Date.now()

  if (!placed.ok) {
    await db.insert(contactLogs).values({
      shopId: user.shopId,
      leadId: lead.id,
      actorId: user.id,
      outcome: 'failed',
      detail: placed.error,
      direction: 'outbound',
      telnyxCallId: null,
      status: 'failed',
      transcript: [],
      recordingUrl: null,
      durationSeconds: null,
      aiDisclosure: true,
      endedAt: now,
      createdAt: now,
      updatedAt: now
    })
    return NextResponse.json({ error: placed.error }, { status: 400 })
  }

  trackDialStart(placed.callControlId)
  await db
    .update(salesLeads)
    .set({
      status: 'contacted',
      lastContactedAt: now,
      attempts: (lead.attempts || 0) + 1,
      updatedAt: now
    })
    .where(eq(salesLeads.id, lead.id))

  await db.insert(contactLogs).values({
    shopId: user.shopId,
    leadId: lead.id,
    actorId: user.id,
    outcome: 'dialing',
    detail: `Manual Call Now · ${placed.to}`,
    direction: 'outbound',
    telnyxCallId: placed.callControlId,
    status: 'dialing',
    transcript: [],
    recordingUrl: null,
    durationSeconds: null,
    aiDisclosure: true,
    endedAt: null,
    createdAt: now,
    updatedAt: now
  })

  return NextResponse.json({
    ok: true,
    callControlId: placed.callControlId,
    to: placed.to,
    message: `AI calling ${lead.businessName} at ${placed.to}…`
  })
}
