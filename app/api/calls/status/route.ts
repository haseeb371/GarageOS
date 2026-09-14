import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { callsPublicBaseUrl, resolveVoiceCarrier, voiceConfigured, voiceFromNumber } from '@/lib/calling'
import { ensureTrainedSalesAgent } from '@/lib/ensureShopDefaults'
import { loadProviderCredentials, resolveSmsCreds } from '@/lib/providerCredentials'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

/** Twilio status callback + Ops status panel. */
export async function POST(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') || ''
  if (!shopId) return NextResponse.json({ error: 'Missing shopId' }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const callSid = String(form?.get('CallSid') || '')
  const callStatus = String(form?.get('CallStatus') || '')
  const duration = String(form?.get('CallDuration') || '')

  if (callSid) {
    const rows = await db.select().from(records).where(eq(records.shopId, shopId))
    const logRow = rows.find(row => {
      if (row.kind !== 'callLogs') return false
      const data = JSON.parse(row.data) as Row
      return String(data.callSid) === callSid
    })
    if (logRow) {
      const data = JSON.parse(logRow.data) as Row
      const now = Date.now()
      const updated = {
        ...data,
        status: callStatus || data.status,
        durationSeconds: duration ? Number(duration) : data.durationSeconds,
        endedAt: ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)
          ? new Date().toISOString()
          : data.endedAt || ''
      }
      await db
        .insert(records)
        .values({
          id: logRow.id,
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
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTrainedSalesAgent(user.shopId)

  const shop = await loadProviderCredentials(user.shopId)
  const creds = resolveSmsCreds(shop)
  const carrier = resolveVoiceCarrier(creds)
  const configured = voiceConfigured(creds)
  const from = voiceFromNumber(creds)
  const base = callsPublicBaseUrl()
  const inboundUrl = `${base}/api/calls/inbound?shopId=${encodeURIComponent(user.shopId)}`
  const carrierLabel = carrier === 'telnyx' ? 'Telnyx' : carrier === 'twilio' ? 'Twilio' : 'none'

  return NextResponse.json({
    configured,
    provider: `AutoGaragify Voice Agent (${carrierLabel || 'no carrier'})`,
    carrier: carrierLabel,
    from: configured ? from : '',
    source:
      carrier === 'telnyx'
        ? 'env'
        : shop.sms.accountSid || shop.sms.from
          ? 'shop'
          : creds.accountSid
            ? 'env'
            : 'none',
    inboundWebhook: inboundUrl,
    message: configured
      ? `Voice ready via ${carrierLabel} from ${from}. Point the number’s Voice webhook to the inbound URL, then place outbound calls from Ops → Voice.`
      : 'Add Telnyx API key + connection + phone (preferred) or Twilio voice credentials. Agent scripts stay AutoGaragify; the carrier only carries the call.',
    setup:
      carrier === 'telnyx'
        ? [
            'Telnyx Mission Control → Numbers → your shop number → Voice → TeXML / webhook.',
            `Webhook URL: ${inboundUrl}`,
            'HTTP POST (TeXML is Twilio-compatible).',
            'Activate a call agent in Ops → Voice (booking or sales).',
            'Place an outbound test call from Ops → Voice.'
          ]
        : [
            'Prefer Telnyx: set TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_PHONE_NUMBER.',
            'Or Twilio: Account SID / Auth Token / voice-capable number in Ops SMS settings.',
            `Inbound webhook: ${inboundUrl}`,
            'Activate a call agent in Ops → Voice, then place an outbound test call.'
          ]
  })
}
