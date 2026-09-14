import { normalizePhone } from '@/lib/sms'
import { resolveSmsCreds, type ProviderCredentials, type SmsCreds } from '@/lib/providerCredentials'
import { appBaseUrl } from '@/lib/stripe'

export type CallDirection = 'inbound' | 'outbound'
export type CallPurpose = 'booking' | 'sales' | 'reminder' | 'custom'

export type CallAgent = {
  id: string
  name: string
  status: 'Draft' | 'Active' | 'Paused'
  purpose: CallPurpose
  greeting: string
  salesPitch: string
  bookingPrompt: string
  goodbye: string
  transferNumber: string
  allowInbound: boolean
  allowOutbound: boolean
  language: string
  notes: string
}

type Row = Record<string, unknown> & { id: string }

export type VoiceCarrier = 'telnyx' | 'twilio' | ''

export function telnyxConfigured() {
  return Boolean(
    process.env.TELNYX_API_KEY?.trim() &&
      process.env.TELNYX_CONNECTION_ID?.trim() &&
      process.env.TELNYX_PHONE_NUMBER?.trim()
  )
}

export function twilioVoiceConfigured(creds?: SmsCreds | null) {
  const resolved = creds || resolveSmsCreds()
  return Boolean(resolved.accountSid && resolved.authToken && resolved.from)
}

export function resolveVoiceCarrier(creds?: SmsCreds | null): VoiceCarrier {
  if (telnyxConfigured()) return 'telnyx'
  if (twilioVoiceConfigured(creds)) return 'twilio'
  return ''
}

export function voiceConfigured(creds?: SmsCreds | null) {
  return resolveVoiceCarrier(creds) !== ''
}

export function voiceFromNumber(creds?: SmsCreds | null) {
  if (telnyxConfigured()) return normalizePhone(String(process.env.TELNYX_PHONE_NUMBER || '')) || String(process.env.TELNYX_PHONE_NUMBER || '')
  const resolved = creds || resolveSmsCreds()
  return normalizePhone(resolved.from) || resolved.from
}

export function escapeXml(value: string) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function defaultCallAgent(shopId: string, shopName: string): CallAgent {
  const name = shopName || 'AutoGaragify'
  return {
    id: `CA-${shopId.slice(0, 8)}`,
    name: `${name} booking agent`,
    status: 'Active',
    purpose: 'booking',
    greeting: `Thanks for calling ${name}. I'm the AutoGaragify voice assistant for the shop.`,
    salesPitch: '',
    bookingPrompt:
      'Tell me the vehicle, the service you need, and a preferred day. For example: oil change tomorrow morning for a 2019 Honda Civic.',
    goodbye: `Thanks for calling ${name}. Someone from the shop will follow up shortly. Goodbye.`,
    transferNumber: '',
    allowInbound: true,
    allowOutbound: true,
    language: 'en-US',
    notes: 'Shop booking line. Telnyx/Twilio carries the call; scripts are AutoGaragify.'
  }
}

/** Trained outbound/inbound agent that sells AutoGaragify to shop owners. */
export function defaultSalesCallAgent(shopId: string): CallAgent {
  return {
    id: `CA-${shopId.slice(0, 8)}-sales`,
    name: 'AutoGaragify sales agent',
    status: 'Active',
    purpose: 'sales',
    greeting:
      'Hi, this is Alex from AutoGaragify. Thanks for taking my call — I will keep this under one minute.',
    salesPitch:
      'AutoGaragify is the shop operating system for independent garages. Online booking, digital inspections, repair orders, parts and inventory, invoices, SMS reminders, email, and automations — all in one place at autogaragify.com. Shops use it to stop juggling spreadsheets and expensive locked-in tools, so advisors spend more time with customers and less time on paperwork. You can run the whole front office from one login, including a built-in voice agent for booking and follow-ups.',
    bookingPrompt:
      'If a short live demo would help, press 1, or say a day this week that works. Press 2 if now is not a good time, and we will follow up by email.',
    goodbye:
      'Thanks for your time. Visit autogaragify.com anytime, or reply to our email and we will set up your shop. Have a great day.',
    transferNumber: '',
    allowInbound: true,
    allowOutbound: true,
    language: 'en-US',
    notes:
      'Trained to sell AutoGaragify. Outbound dials pitch the product, capture demo interest (press 1 / speech), and open a support lead. Activate and dial from Ops → Voice.'
  }
}

export function classifySalesReply(speech: string, digits: string): 'interested' | 'not_now' | 'other' {
  const d = String(digits || '').trim()
  if (d === '1') return 'interested'
  if (d === '2' || d === '9') return 'not_now'
  const text = String(speech || '').toLowerCase()
  if (!text) return 'other'
  if (
    /\b(yes|yeah|yep|sure|demo|interested|schedule|book|tomorrow|monday|tuesday|wednesday|thursday|friday|this week|next week|call me|sounds good)\b/.test(
      text
    )
  ) {
    return 'interested'
  }
  if (/\b(no|not interested|busy|stop|remove|wrong number|do not call|don't call)\b/.test(text)) {
    return 'not_now'
  }
  return 'other'
}

export function pickActiveAgent(agents: Row[], purpose?: string) {
  const list = agents.filter(a => String(a.status) === 'Active')
  if (purpose) {
    const match = list.find(a => String(a.purpose) === purpose)
    if (match) return match
  }
  return list[0] || agents[0] || null
}

export function twimlResponse(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`
}

export function buildInboundTwiml(input: {
  agent: Row
  shopId: string
  baseUrl: string
}) {
  const agent = input.agent
  const gatherAction = `${input.baseUrl}/api/calls/gather?shopId=${encodeURIComponent(input.shopId)}&agentId=${encodeURIComponent(String(agent.id))}`
  const greeting = escapeXml(String(agent.greeting || 'Thanks for calling.'))
  const pitch =
    String(agent.purpose) === 'sales'
      ? `<Say voice="Polly.Joanna">${escapeXml(String(agent.salesPitch || ''))}</Say>`
      : ''
  const prompt = escapeXml(
    String(agent.bookingPrompt || 'Please tell us how we can help, then press pound when finished.')
  )
  const transfer = normalizePhone(String(agent.transferNumber || ''))

  const gather = `
    <Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${escapeXml(gatherAction)}" method="POST">
      <Say voice="Polly.Joanna">${prompt}</Say>
    </Gather>`

  const fallback = transfer
    ? `<Say voice="Polly.Joanna">Connecting you to the shop now.</Say><Dial>${escapeXml(transfer)}</Dial>`
    : `<Say voice="Polly.Joanna">${escapeXml(String(agent.goodbye || 'Goodbye.'))}</Say><Hangup/>`

  return twimlResponse(`
    <Say voice="Polly.Joanna">${greeting}</Say>
    ${pitch}
    ${gather}
    ${fallback}
  `)
}

export function buildGatherResultTwiml(input: {
  agent: Row
  speech: string
  digits: string
}) {
  const purpose = String(input.agent.purpose || '')
  const heard = escapeXml(input.speech || input.digits || 'your request')
  const goodbye = escapeXml(String(input.agent.goodbye || 'Thanks. We will follow up shortly. Goodbye.'))
  const transfer = normalizePhone(String(input.agent.transferNumber || ''))

  if ((input.digits === '0' || input.digits === '1') && transfer && purpose === 'sales') {
    return twimlResponse(`
      <Say voice="Polly.Joanna">Great — connecting you to the AutoGaragify team now.</Say>
      <Dial>${escapeXml(transfer)}</Dial>
    `)
  }

  if (input.digits === '0' && transfer) {
    return twimlResponse(`
      <Say voice="Polly.Joanna">Connecting you to a team member now.</Say>
      <Dial>${escapeXml(transfer)}</Dial>
    `)
  }

  if (purpose === 'sales') {
    const intent = classifySalesReply(input.speech, input.digits)
    if (intent === 'interested') {
      return twimlResponse(`
        <Say voice="Polly.Joanna">Perfect. I logged a demo request${input.speech ? ` for ${heard}` : ''}. Someone from AutoGaragify will confirm shortly. Meanwhile you can explore autogaragify.com. ${goodbye}</Say>
        <Hangup/>
      `)
    }
    if (intent === 'not_now') {
      return twimlResponse(`
        <Say voice="Polly.Joanna">No problem at all. I will note that now is not a good time. ${goodbye}</Say>
        <Hangup/>
      `)
    }
    return twimlResponse(`
      <Say voice="Polly.Joanna">Got it. I captured ${heard}. Our team will follow up with details on AutoGaragify. ${goodbye}</Say>
      <Hangup/>
    `)
  }

  return twimlResponse(`
    <Say voice="Polly.Joanna">Got it. I heard ${heard}. ${goodbye}</Say>
    <Hangup/>
  `)
}

export function buildOutboundTwiml(input: {
  agent: Row
  purpose: string
  customerName: string
  message: string
  shopId?: string
  baseUrl?: string
}) {
  const name = escapeXml(input.customerName || 'there')
  const purpose = input.purpose || String(input.agent.purpose || '')
  const greeting = escapeXml(String(input.agent.greeting || 'Hello from AutoGaragify.'))
  const body = escapeXml(
    input.message ||
      (purpose === 'sales'
        ? String(input.agent.salesPitch || '')
        : String(input.agent.bookingPrompt || 'This is a follow-up call from the shop.'))
  )
  const cta = escapeXml(
    String(
      input.agent.bookingPrompt ||
        'If a short demo would help, press 1, or say a day this week. Press 2 if now is not a good time.'
    )
  )
  const goodbye = escapeXml(String(input.agent.goodbye || 'Goodbye.'))
  const transfer = normalizePhone(String(input.agent.transferNumber || ''))
  const gatherAction =
    input.baseUrl && input.shopId
      ? `${input.baseUrl}/api/calls/gather?shopId=${encodeURIComponent(input.shopId)}&agentId=${encodeURIComponent(String(input.agent.id))}`
      : ''

  if (purpose === 'sales') {
    const gather = gatherAction
      ? `<Gather input="speech dtmf" timeout="7" numDigits="1" speechTimeout="auto" action="${escapeXml(gatherAction)}" method="POST">
           <Say voice="Polly.Joanna">${cta}</Say>
         </Gather>`
      : transfer
        ? `<Say voice="Polly.Joanna">Press 1 to speak with the team.</Say>
           <Gather numDigits="1" timeout="5"><Say voice="Polly.Joanna">Press 1 now.</Say></Gather>
           <Dial>${escapeXml(transfer)}</Dial>`
        : ''

    return twimlResponse(`
      <Say voice="Polly.Joanna">Hi ${name}. ${greeting}</Say>
      <Say voice="Polly.Joanna">${body}</Say>
      ${gather}
      <Say voice="Polly.Joanna">${goodbye}</Say>
      <Hangup/>
    `)
  }

  return twimlResponse(`
    <Say voice="Polly.Joanna">Hi ${name}. ${greeting}</Say>
    <Say voice="Polly.Joanna">${body}</Say>
    <Say voice="Polly.Joanna">${goodbye}</Say>
    <Hangup/>
  `)
}

async function placeTelnyxOutboundCall(input: {
  to: string
  twimlUrl: string
  statusCallback: string
}) {
  const apiKey = String(process.env.TELNYX_API_KEY || '').trim()
  const connectionId = String(process.env.TELNYX_CONNECTION_ID || '').trim()
  const from = normalizePhone(String(process.env.TELNYX_PHONE_NUMBER || '')) || String(process.env.TELNYX_PHONE_NUMBER || '')
  const to = normalizePhone(input.to)
  if (!to) {
    return { ok: false as const, sandbox: false as const, error: 'Destination phone must be E.164 (e.g. +15551234567).' }
  }

  const form = new URLSearchParams({
    To: to,
    From: from,
    Url: input.twimlUrl,
    StatusCallback: input.statusCallback,
    StatusCallbackMethod: 'POST'
  })

  const response = await fetch(`https://api.telnyx.com/v2/texml/calls/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: form.toString()
  })

  const result = (await response.json().catch(() => ({}))) as {
    data?: { call_session_id?: string; call_control_id?: string; call_leg_id?: string; status?: string }
    errors?: Array<{ detail?: string; title?: string }>
    sid?: string
    status?: string
    message?: string
  }

  if (!response.ok) {
    const detail = result.errors?.[0]?.detail || result.errors?.[0]?.title || result.message
    return {
      ok: false as const,
      sandbox: false as const,
      error: detail || `Telnyx Voice returned ${response.status}`
    }
  }

  const sid =
    result.data?.call_session_id ||
    result.data?.call_control_id ||
    result.data?.call_leg_id ||
    result.sid ||
    ''

  return {
    ok: true as const,
    sandbox: false as const,
    sid,
    status: result.data?.status || result.status || 'queued',
    to,
    from,
    carrier: 'telnyx' as const
  }
}

async function placeTwilioOutboundCall(input: {
  to: string
  twimlUrl: string
  statusCallback: string
  creds: SmsCreds
}) {
  const to = normalizePhone(input.to)
  if (!to) {
    return { ok: false as const, sandbox: false as const, error: 'Destination phone must be E.164 (e.g. +15551234567).' }
  }

  const from = normalizePhone(input.creds.from) || input.creds.from
  const auth = Buffer.from(`${input.creds.accountSid}:${input.creds.authToken}`).toString('base64')
  const form = new URLSearchParams({
    To: to,
    From: from,
    Url: input.twimlUrl,
    Method: 'POST',
    StatusCallback: input.statusCallback,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed'
  })

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${input.creds.accountSid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  })

  const result = (await response.json().catch(() => ({}))) as {
    sid?: string
    message?: string
    error_message?: string
    status?: string
  }

  if (!response.ok) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: result.error_message || result.message || `Twilio Voice returned ${response.status}`
    }
  }

  return {
    ok: true as const,
    sandbox: false as const,
    sid: result.sid || '',
    status: result.status || 'queued',
    to,
    from,
    carrier: 'twilio' as const
  }
}

export async function placeOutboundCall(input: {
  to: string
  shopId: string
  twimlUrl: string
  statusCallback: string
  creds?: SmsCreds | null
  shopCreds?: ProviderCredentials | null
}) {
  const creds = input.creds || resolveSmsCreds(input.shopCreds)
  const carrier = resolveVoiceCarrier(creds)
  if (!carrier) {
    return {
      ok: false as const,
      sandbox: true as const,
      error: 'Add Telnyx (TELNYX_API_KEY + connection + phone) or Twilio voice credentials, then retry.'
    }
  }

  if (carrier === 'telnyx') {
    return placeTelnyxOutboundCall({
      to: input.to,
      twimlUrl: input.twimlUrl,
      statusCallback: input.statusCallback
    })
  }

  return placeTwilioOutboundCall({
    to: input.to,
    twimlUrl: input.twimlUrl,
    statusCallback: input.statusCallback,
    creds
  })
}

export function callsPublicBaseUrl() {
  return appBaseUrl()
}
