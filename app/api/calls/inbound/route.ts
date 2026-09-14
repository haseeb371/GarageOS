import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import {
  buildInboundTwiml,
  pickActiveAgent,
  voiceConfigured
} from '@/lib/calling'
import { appBaseUrl } from '@/lib/stripe'
import { loadProviderCredentials, resolveSmsCreds } from '@/lib/providerCredentials'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

async function shopAgents(shopId: string) {
  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const agents: Row[] = []
  for (const row of rows) {
    if (row.kind === 'callAgents') agents.push(JSON.parse(row.data) as Row)
  }
  return agents
}

async function writeCallLog(shopId: string, log: Row) {
  const now = Date.now()
  await db
    .insert(records)
    .values({
      id: log.id,
      kind: 'callLogs',
      shopId,
      data: JSON.stringify({ ...log, shopId }),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: records.id,
      set: { data: JSON.stringify({ ...log, shopId }), updatedAt: now }
    })
}

/** Twilio Voice webhook — configure number Voice URL to /api/calls/inbound?shopId=... */
export async function POST(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') || ''
  if (!shopId) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Shop is not configured.</Say><Hangup/></Response>',
      { status: 400, headers: { 'Content-Type': 'text/xml' } }
    )
  }

  const form = await req.formData().catch(() => null)
  const from = String(form?.get('From') || '')
  const to = String(form?.get('To') || '')
  const callSid = String(form?.get('CallSid') || `CL-${Date.now()}`)

  const agents = await shopAgents(shopId)
  const agent = pickActiveAgent(agents)
  if (!agent || agent.allowInbound === false || String(agent.status) !== 'Active') {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>The voice agent is not active. Please try again later.</Say><Hangup/></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }

  const shop = await loadProviderCredentials(shopId)
  const creds = resolveSmsCreds(shop)
  if (!voiceConfigured(creds)) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice calling is not connected for this shop yet.</Say><Hangup/></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }

  await writeCallLog(shopId, {
    id: `CL-${callSid.slice(-10)}`,
    callSid,
    direction: 'inbound',
    status: 'in-progress',
    from,
    to,
    agentId: agent.id,
    agentName: agent.name,
    purpose: agent.purpose || 'booking',
    transcript: '',
    customerId: '',
    startedAt: new Date().toISOString(),
    endedAt: '',
    notes: 'Inbound call answered by AutoGaragify voice agent'
  })

  const xml = buildInboundTwiml({
    agent,
    shopId,
    baseUrl: appBaseUrl()
  })

  return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } })
}

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') || ''
  return NextResponse.json({
    ok: true,
    message: 'POST from Twilio Voice to this URL with ?shopId=...',
    example: `${appBaseUrl()}/api/calls/inbound?shopId=${shopId || 'YOUR_SHOP_ID'}`
  })
}
