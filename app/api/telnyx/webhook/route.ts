import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db, ensureSchema } from '@/lib/db'
import { contactLogs, salesLeads } from '@/lib/schema'
import type { TranscriptChunk } from '@/lib/schema'
import {
  answerWithAssistant,
  answerWithUnavailableTts,
  hangupCall,
  verifyWebhookSignature,
  verifyWebhookSignatureSimple
} from '@/lib/telnyx'
import { rememberWebhookEvent } from '@/lib/webhookIdempotency'
import { assertOutboundDisclosure, detectDncIntent } from '@/lib/aiAgent/transcript'
import { addPhoneToDnc, dispatchAgentTool, ensureInboundLead, recordComplianceViolation } from '@/lib/aiAgent/tools'
import { releaseDial } from '@/lib/dialer'
import { normalizeUsPhone } from '@/lib/leads'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

type TelnyxPayload = {
  data?: {
    event_type?: string
    id?: string
    occurred_at?: string
    payload?: Record<string, unknown>
  }
}

function decodeClientState(raw: unknown): {
  leadId?: string
  shopId?: string
  campaign?: string
  direction?: string
} {
  if (!raw || typeof raw !== 'string') return {}
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      leadId?: string
      shopId?: string
      campaign?: string
      direction?: string
    }
  } catch {
    return {}
  }
}

/** Map inbound DID → shop; null when unknown. */
function resolveShopId(clientState: { shopId?: string }, toNumber: string): string | null {
  if (clientState.shopId) return clientState.shopId
  const mapped = getConfig().LEADS_IMPORT_SHOP_ID
  const from = getConfig().TELNYX_FROM_NUMBER
  if (mapped && from && toNumber && from.replace(/\D/g, '') === toNumber.replace(/\D/g, '')) {
    return mapped
  }
  if (mapped) return mapped
  return null
}

async function findLogByCallId(callId: string) {
  if (!callId) return null
  const [row] = await db
    .select()
    .from(contactLogs)
    .where(eq(contactLogs.telnyxCallId, callId))
    .orderBy(desc(contactLogs.createdAt))
    .limit(1)
  return row || null
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const rawBody = await req.text()

  const sig =
    req.headers.get('telnyx-signature-ed25519') || req.headers.get('Telnyx-Signature-Ed25519')
  const ts = req.headers.get('telnyx-timestamp') || req.headers.get('Telnyx-Timestamp')

  // Reject missing/invalid public key and signatures (test secret still allowed for unit tests).
  const verified =
    process.env.TELNYX_WEBHOOK_TEST_SECRET && sig === process.env.TELNYX_WEBHOOK_TEST_SECRET
      ? verifyWebhookSignatureSimple({
          rawBody,
          signature: sig,
          timestamp: ts || '0',
          testSecret: process.env.TELNYX_WEBHOOK_TEST_SECRET
        })
      : verifyWebhookSignature(rawBody, req.headers)

  if (!verified.ok) {
    return NextResponse.json({ error: verified.error || 'Unauthorized' }, { status: 401 })
  }

  let body: TelnyxPayload = {}
  try {
    body = JSON.parse(rawBody) as TelnyxPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = String(body.data?.event_type || '')
  const eventId = String(body.data?.id || '')
  if (!rememberWebhookEvent(eventId || `${eventType}:${rawBody.slice(0, 80)}`)) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  const payload = body.data?.payload || {}
  const callControlId = String(payload.call_control_id || payload.call_leg_id || '')
  const clientState = decodeClientState(payload.client_state)
  const directionRaw = String(payload.direction || clientState.direction || '').toLowerCase()
  const direction =
    directionRaw === 'incoming' || directionRaw === 'inbound' ? 'inbound' : 'outbound'
  const toNumber = String(payload.to || payload.connection_phone_number || '')
  const shopId = resolveShopId(clientState, toNumber)
  const now = Date.now()

  if (eventType === 'call.initiated') {
    let inboundLeadId =
      clientState.leadId && clientState.leadId !== 'TEST-CALL' ? clientState.leadId : null
    if (direction === 'inbound' && shopId) {
      const created = await ensureInboundLead(shopId, String(payload.from || ''))
      if (created) inboundLeadId = created
    }

    const existing = await findLogByCallId(callControlId)
    if (!existing) {
      await db.insert(contactLogs).values({
        shopId,
        leadId: inboundLeadId,
        actorId: direction === 'inbound' ? 'telnyx-inbound' : 'telnyx-outbound',
        outcome: direction === 'inbound' ? 'in_progress' : 'dialing',
        detail:
          direction === 'inbound'
            ? `Inbound from ${String(payload.from || '')}${shopId ? '' : ' · unmatched shop'}`
            : `Outbound to ${String(payload.to || '')}${clientState.campaign ? ` · ${clientState.campaign}` : ''}`,
        direction,
        telnyxCallId: callControlId,
        status: direction === 'inbound' ? 'in_progress' : 'dialing',
        transcript: [],
        recordingUrl: null,
        durationSeconds: null,
        aiDisclosure: true,
        endedAt: null,
        createdAt: now,
        updatedAt: now
      })
    }

    if (direction === 'inbound') {
      if (!getConfig().TELNYX_ASSISTANT_ID) {
        await answerWithUnavailableTts(callControlId)
      } else {
        await answerWithAssistant(callControlId, 'inbound', inboundLeadId || undefined)
      }
    }
    return NextResponse.json({ ok: true, shopId, leadId: inboundLeadId })
  }

  if (eventType === 'call.answered') {
    const log = await findLogByCallId(callControlId)
    if (log) {
      await db
        .update(contactLogs)
        .set({ status: 'in_progress', outcome: 'in_progress', updatedAt: now })
        .where(eq(contactLogs.id, log.id))
    } else if (shopId || clientState.leadId) {
      // Outbound answered before initiated webhook — still keep a trackable row.
      await db.insert(contactLogs).values({
        shopId,
        leadId: clientState.leadId && clientState.leadId !== 'TEST-CALL' ? clientState.leadId : null,
        actorId: 'telnyx-outbound',
        outcome: 'in_progress',
        detail: `Outbound answered · ${String(payload.to || '')}`,
        direction: 'outbound',
        telnyxCallId: callControlId,
        status: 'in_progress',
        transcript: [],
        recordingUrl: null,
        durationSeconds: null,
        aiDisclosure: true,
        endedAt: null,
        createdAt: now,
        updatedAt: now
      })
    }
    return NextResponse.json({ ok: true })
  }

  if (eventType === 'call.transcription' || eventType === 'call.conversation.insight') {
    const transcription = payload.transcription as { text?: string } | undefined
    const text = String(payload.transcript || payload.text || transcription?.text || '')
    const role = String(payload.role || payload.speaker || 'caller')
    const log = await findLogByCallId(callControlId)
    if (log && text) {
      const prev = (log.transcript || []) as TranscriptChunk[]
      const next: TranscriptChunk[] = [...prev, { role, text, at: now }]
      await db
        .update(contactLogs)
        .set({ transcript: next, updatedAt: now })
        .where(eq(contactLogs.id, log.id))

      if (
        log.direction === 'outbound' &&
        next.filter(c => /assistant|ai|bot/i.test(c.role)).length === 1
      ) {
        const check = assertOutboundDisclosure(next)
        if (!check.ok) {
          await recordComplianceViolation({
            shopId: log.shopId || shopId || 'unknown',
            leadId: log.leadId,
            contactLogId: log.id,
            reason: 'missing_ai_disclosure',
            detail: check.firstMessage || 'empty first assistant message'
          })
          await hangupCall(callControlId)
        } else {
          await db
            .update(contactLogs)
            .set({ aiDisclosure: true, updatedAt: now })
            .where(eq(contactLogs.id, log.id))
        }
      }

      if (detectDncIntent(text) && log.leadId) {
        await dispatchAgentTool({
          name: 'mark_dnc',
          args: { lead_id: log.leadId },
          shopId: log.shopId || shopId || 'unknown',
          callControlId
        })
        const from = String(payload.from || '')
        if (from && (log.shopId || shopId)) {
          await addPhoneToDnc(log.shopId || shopId!, from, 'Transcript DNC phrase')
        }
        await hangupCall(callControlId)
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (eventType === 'call.tool_invoked' || eventType === 'assistant.tool_call') {
    const toolName = String(payload.tool_name || payload.name || '')
    const args = (payload.arguments || payload.parameters || {}) as Record<string, unknown>
    const leadId = String(args.lead_id || clientState.leadId || '')
    await dispatchAgentTool({
      name: toolName,
      args: { ...args, lead_id: leadId },
      shopId: shopId || 'unknown',
      callControlId,
      direction
    })
    return NextResponse.json({ ok: true })
  }

  if (eventType === 'call.hangup' || eventType === 'call.ended') {
    releaseDial(callControlId)
    const log = await findLogByCallId(callControlId)
    if (log) {
      const started = log.createdAt || now
      const duration = Math.max(0, Math.round((now - started) / 1000))
      const recordingUrls = payload.recording_urls
      const recordingUrl = String(
        (Array.isArray(recordingUrls) ? recordingUrls[0] : '') ||
          payload.recording_url ||
          log.recordingUrl ||
          ''
      )
      let outcome = log.outcome
      if (outcome === 'dialing' || outcome === 'in_progress') {
        const hangupCause = String(payload.hangup_cause || payload.hangup_source || '')
        if (/no_answer|busy|timeout/i.test(hangupCause)) outcome = 'no_answer'
        else if (/machine|amd/i.test(hangupCause)) outcome = 'voicemail'
        else outcome = log.outcome === 'dialing' ? 'no_answer' : log.outcome
      }
      await db
        .update(contactLogs)
        .set({
          endedAt: now,
          durationSeconds: duration,
          recordingUrl: recordingUrl || null,
          transcript: log.transcript || [],
          outcome,
          status: outcome,
          updatedAt: now
        })
        .where(eq(contactLogs.id, log.id))
    }
    return NextResponse.json({ ok: true })
  }

  if (eventType === 'call.inbound_lead_capture' && shopId) {
    const businessName = String(payload.business_name || '').trim()
    const phone = String(payload.phone || payload.from || '').trim()
    const normalized = normalizeUsPhone(phone)
    if (businessName && normalized.ok) {
      const id = `LEAD-IN-${now}`
      await db.insert(salesLeads).values({
        id,
        shopId,
        businessName,
        phone: normalized.formatted,
        phoneDigits: normalized.digits,
        address: '',
        website: null,
        rating: null,
        reviewCount: null,
        placeId: `inbound-${normalized.digits}-${now}`,
        source: 'inbound_call',
        campaign: '',
        status: 'new',
        notes: 'Created from inbound AI call',
        attempts: 0,
        retryAfter: null,
        createdAt: now,
        lastContactedAt: now,
        updatedAt: now
      })
      const log = await findLogByCallId(callControlId)
      if (log) {
        await db
          .update(contactLogs)
          .set({ leadId: id, updatedAt: now })
          .where(eq(contactLogs.id, log.id))
      }
    }
  }

  return NextResponse.json({ ok: true, ignored: eventType || 'unknown' })
}
