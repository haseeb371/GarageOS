import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import {
  buildOutboundTwiml,
  pickActiveAgent,
  placeOutboundCall,
  voiceConfigured
} from '@/lib/calling'
import { appBaseUrl } from '@/lib/stripe'
import { ensureTrainedSalesAgent } from '@/lib/ensureShopDefaults'
import { loadProviderCredentials, resolveSmsCreds } from '@/lib/providerCredentials'
import { normalizePhone } from '@/lib/sms'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  to: z.string().min(7),
  agentId: z.string().optional(),
  purpose: z.enum(['booking', 'sales', 'reminder', 'custom']).optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  message: z.string().optional()
})

export const dynamic = 'force-dynamic'

/** Serves TwiML for an already-placed outbound call (Twilio fetches this URL). */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') || ''
  const agentId = req.nextUrl.searchParams.get('agentId') || ''
  const purpose = req.nextUrl.searchParams.get('purpose') || 'sales'
  const customerName = req.nextUrl.searchParams.get('customerName') || 'there'
  const message = req.nextUrl.searchParams.get('message') || ''

  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const agents = rows.filter(r => r.kind === 'callAgents').map(r => JSON.parse(r.data) as Row)
  const agent =
    agents.find(a => a.id === agentId) ||
    pickActiveAgent(agents, purpose) ||
    ({ id: 'fallback', greeting: 'Hello.', salesPitch: '', bookingPrompt: '', goodbye: 'Goodbye.', transferNumber: '' } as Row)

  const xml = buildOutboundTwiml({
    agent,
    purpose,
    customerName,
    message,
    shopId,
    baseUrl: appBaseUrl()
  })
  return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner, Manager, or Advisor can place outbound calls.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid outbound call request.' }, { status: 400 })
  }

  await ensureTrainedSalesAgent(user.shopId)

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const agents = rows.filter(r => r.kind === 'callAgents').map(r => JSON.parse(r.data) as Row)
  const customers = rows.filter(r => r.kind === 'customers').map(r => JSON.parse(r.data) as Row)

  const purpose = parsed.data.purpose || 'sales'
  const agent =
    (parsed.data.agentId && agents.find(a => a.id === parsed.data.agentId)) ||
    pickActiveAgent(agents, purpose)

  if (!agent || String(agent.status) !== 'Active') {
    return NextResponse.json({ error: 'No Active call agent found. Activate a voice agent in Ops → Voice.' }, { status: 400 })
  }
  if (agent.allowOutbound === false) {
    return NextResponse.json({ error: 'This agent does not allow outbound calls.' }, { status: 400 })
  }

  let to = parsed.data.to
  let customerName = parsed.data.customerName || ''
  if (parsed.data.customerId) {
    const customer = customers.find(c => c.id === parsed.data.customerId)
    if (customer) {
      to = String(customer.phone || to)
      customerName = String(customer.name || customerName)
    }
  }

  const shopCreds = await loadProviderCredentials(user.shopId)
  const smsCreds = resolveSmsCreds(shopCreds)
  if (!voiceConfigured(smsCreds)) {
    return NextResponse.json(
      {
        error:
          'Connect Telnyx (API key + connection + phone) or Twilio voice credentials before placing calls.'
      },
      { status: 503 }
    )
  }

  const base = appBaseUrl()
  const twimlUrl =
    `${base}/api/calls/outbound?shopId=${encodeURIComponent(user.shopId)}` +
    `&agentId=${encodeURIComponent(String(agent.id))}` +
    `&purpose=${encodeURIComponent(purpose)}` +
    `&customerName=${encodeURIComponent(customerName || 'there')}` +
    `&message=${encodeURIComponent(parsed.data.message || '')}`
  const statusCallback = `${base}/api/calls/status?shopId=${encodeURIComponent(user.shopId)}`

  const result = await placeOutboundCall({
    to,
    shopId: user.shopId,
    twimlUrl,
    statusCallback,
    creds: smsCreds
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
  }

  const now = Date.now()
  const log = {
    id: `CL-${String(result.sid || now).slice(-10)}`,
    callSid: result.sid,
    direction: 'outbound',
    status: result.status || 'queued',
    from: result.from,
    to: result.to || normalizePhone(to),
    agentId: agent.id,
    agentName: agent.name,
    purpose,
    transcript: parsed.data.message || '',
    customerId: parsed.data.customerId || '',
    customerName,
    startedAt: new Date().toISOString(),
    endedAt: '',
    notes: 'Outbound call placed by AutoGaragify voice agent',
    shopId: user.shopId
  }

  await db.insert(records).values({
    id: log.id,
    kind: 'callLogs',
    shopId: user.shopId,
    data: JSON.stringify(log),
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing()

  await db.insert(auditLog).values({
    actor: user.id,
    action: 'calls.outbound',
    entity: 'callLogs',
    entityId: log.id,
    detail: `Outbound ${purpose} call to ${log.to}`,
    createdAt: now
  })

  return NextResponse.json({
    ok: true,
    callId: log.id,
    sid: result.sid,
    to: result.to,
    from: result.from,
    status: result.status,
    message: `Calling ${result.to}…`
  })
}
