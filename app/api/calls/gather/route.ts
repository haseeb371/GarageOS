import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { buildGatherResultTwiml, classifySalesReply } from '@/lib/calling'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') || ''
  const agentId = req.nextUrl.searchParams.get('agentId') || ''
  if (!shopId) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Missing shop.</Say><Hangup/></Response>',
      { status: 400, headers: { 'Content-Type': 'text/xml' } }
    )
  }

  const form = await req.formData().catch(() => null)
  const speech = String(form?.get('SpeechResult') || '').trim()
  const digits = String(form?.get('Digits') || '').trim()
  const callSid = String(form?.get('CallSid') || '')

  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  let agent: Row | null = null
  let log: Row | null = null
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    if (row.kind === 'callAgents' && (!agentId || data.id === agentId)) agent = data
    if (row.kind === 'callLogs' && callSid && String(data.callSid) === callSid) log = data
  }
  if (!agent) {
    agent = { id: 'fallback', goodbye: 'Thanks. Goodbye.', transferNumber: '' }
  }

  if (log) {
    const now = Date.now()
    const updated = {
      ...log,
      transcript: speech || digits || log.transcript || '',
      notes: `Caller said: ${speech || digits || '(no speech)'}`,
      status: 'completed',
      endedAt: new Date().toISOString()
    }
    await db
      .insert(records)
      .values({
        id: String(log.id),
        kind: 'callLogs',
        shopId,
        data: JSON.stringify({ ...updated, shopId }),
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: records.id,
        set: { data: JSON.stringify({ ...updated, shopId }), updatedAt: now }
      })
  }

  // Create an internal follow-up ticket so the shop can act on the request
  if (speech || digits) {
    const now = Date.now()
    const purpose = String(agent.purpose || '')
    const intent = purpose === 'sales' ? classifySalesReply(speech, digits) : 'other'
    const ticket = {
      id: `SUP-CALL-${String(now).slice(-8)}`,
      subject:
        purpose === 'sales'
          ? intent === 'interested'
            ? `Sales demo request · ${callSid || 'call'}`
            : intent === 'not_now'
              ? `Sales follow-up later · ${callSid || 'call'}`
              : `Sales voice lead · ${callSid || 'call'}`
          : `Voice call request · ${callSid || 'inbound'}`,
      priority: intent === 'interested' ? 'High' : 'Normal',
      status: 'Open',
      category: purpose === 'sales' ? 'Sales lead' : 'Voice agent',
      requester: String(form?.get('From') || 'Caller'),
      description:
        purpose === 'sales'
          ? `AutoGaragify sales agent capture (${intent}):\n${speech || digits}\n\nCall SID: ${callSid}\nAgent: ${agent.id}`
          : `Inbound voice agent capture:\n${speech || digits}\n\nCall SID: ${callSid}`,
      createdAt: new Date().toISOString(),
      resolvedAt: '',
      shopId
    }
    await db.insert(records).values({
      id: ticket.id,
      kind: 'supportTickets',
      shopId,
      data: JSON.stringify(ticket),
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing()
  }

  const xml = buildGatherResultTwiml({ agent, speech, digits })
  return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } })
}
