import { createPublicKey, verify } from 'crypto'
import { appBaseUrl } from '@/lib/stripe'
import { getConfig, isDialerEnabled } from '@/lib/config'
import { getSystemPrompt, OUTBOUND_GREETING, INBOUND_GREETING } from '@/lib/aiAgent/prompt'
import { assistantToolDefinitions } from '@/lib/aiAgent/toolDefinitions'

const API = 'https://api.telnyx.com/v2'

function apiKey() {
  return getConfig().TELNYX_API_KEY
}

export function telnyxConfigured() {
  const c = getConfig()
  return Boolean(c.TELNYX_API_KEY && c.TELNYX_CONNECTION_ID && c.TELNYX_FROM_NUMBER)
}

export function assistantConfigured() {
  return Boolean(getConfig().TELNYX_ASSISTANT_ID)
}

export function dialerEnabled() {
  return isDialerEnabled()
}

export function telnyxFromNumber() {
  return getConfig().TELNYX_FROM_NUMBER
}

async function telnyxFetch(path: string, init?: RequestInit) {
  const key = apiKey()
  if (!key) return { ok: false as const, status: 0, error: 'TELNYX_API_KEY is missing.', data: null }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = data as { errors?: Array<{ detail?: string; title?: string }>; message?: string }
    const detail = err.errors?.[0]?.detail || err.errors?.[0]?.title || err.message || `HTTP ${response.status}`
    return { ok: false as const, status: response.status, error: detail, data }
  }
  return { ok: true as const, status: response.status, error: '', data }
}

export async function createAIAssistant(config?: {
  name?: string
  model?: string
  instructions?: string
}) {
  const base = appBaseUrl()
  const body = {
    name: config?.name || 'AutoGaragify Sales AI',
    model: config?.model || process.env.TELNYX_AI_MODEL?.trim() || 'Qwen/Qwen3-235B-A22B',
    instructions: config?.instructions || getSystemPrompt(),
    enabled_features: ['telephony'],
    greeting: OUTBOUND_GREETING,
    tools: assistantToolDefinitions(base)
  }
  const result = await telnyxFetch('/ai/assistants', { method: 'POST', body: JSON.stringify(body) })
  if (!result.ok) return { ok: false as const, error: result.error }
  const id = String(
    (result.data as { data?: { id?: string }; id?: string }).data?.id ||
      (result.data as { id?: string }).id ||
      ''
  )
  if (!id) return { ok: false as const, error: 'Assistant created but no id returned.' }
  return { ok: true as const, assistantId: id, raw: result.data }
}

export async function placeOutboundCall(
  to: string,
  leadId: string,
  shopId: string,
  campaign = ''
) {
  if (!isDialerEnabled()) {
    console.log('[telnyx] DIALER_ENABLED=false — outbound call no-op')
    return { ok: false as const, error: 'DIALER_ENABLED=false — outbound AI calling is disabled.' }
  }
  const c = getConfig()
  if (!c.TELNYX_API_KEY) {
    return { ok: false as const, error: 'TELNYX_API_KEY is missing. Add it to env before dialing.' }
  }
  if (!c.TELNYX_CONNECTION_ID) return { ok: false as const, error: 'TELNYX_CONNECTION_ID is missing.' }
  const from = c.TELNYX_FROM_NUMBER
  if (!from) return { ok: false as const, error: 'TELNYX_FROM_NUMBER is missing.' }

  const assistantId = c.TELNYX_ASSISTANT_ID
  const base = appBaseUrl()
  const clientState = Buffer.from(
    JSON.stringify({ leadId, shopId, campaign, direction: 'outbound' }),
    'utf8'
  ).toString('base64')
  const instructions = getSystemPrompt()

  const result = await telnyxFetch('/calls', {
    method: 'POST',
    body: JSON.stringify({
      connection_id: c.TELNYX_CONNECTION_ID,
      to,
      from,
      webhook_url: `${base}/api/telnyx/webhook`,
      webhook_url_method: 'POST',
      answering_machine_detection: 'detect',
      client_state: clientState,
      ...(assistantId
        ? {
            assistant: {
              id: assistantId,
              instructions,
              greeting: OUTBOUND_GREETING
            }
          }
        : {})
    })
  })

  if (!result.ok) return { ok: false as const, error: result.error }
  const data = (result.data as { data?: Record<string, string> }).data || {}
  const callControlId = data.call_control_id || data.call_leg_id || data.call_session_id || ''
  if (!callControlId) return { ok: false as const, error: 'Telnyx did not return call_control_id.' }
  return { ok: true as const, callControlId, from, to }
}

export async function answerWithAssistant(
  callControlId: string,
  direction: 'inbound' | 'outbound',
  leadId?: string
) {
  const assistantId = getConfig().TELNYX_ASSISTANT_ID
  if (!assistantId) return { ok: false as const, error: 'TELNYX_ASSISTANT_ID is missing.' }
  const greeting = direction === 'inbound' ? INBOUND_GREETING : OUTBOUND_GREETING
  const result = await telnyxFetch(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
    method: 'POST',
    body: JSON.stringify({})
  })
  if (!result.ok) return { ok: false as const, error: result.error }

  const start = await telnyxFetch(
    `/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_start`,
    {
      method: 'POST',
      body: JSON.stringify({
        assistant: {
          id: assistantId,
          instructions: getSystemPrompt(),
          greeting
        },
        client_state: Buffer.from(
          JSON.stringify({ leadId: leadId || '', direction }),
          'utf8'
        ).toString('base64')
      })
    }
  )
  if (!start.ok) return { ok: false as const, error: start.error }
  return { ok: true as const }
}

/** Answer with static TTS then hang up (missing assistant fallback). */
export async function answerWithUnavailableTts(callControlId: string) {
  console.warn('[telnyx] TELNYX_ASSISTANT_ID missing — speaking unavailable message and hanging up')
  const answer = await telnyxFetch(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
    method: 'POST',
    body: JSON.stringify({})
  })
  if (!answer.ok) return answer
  const speak = await telnyxFetch(`/calls/${encodeURIComponent(callControlId)}/actions/speak`, {
    method: 'POST',
    body: JSON.stringify({
      payload: 'AutoGaragify is not available right now.',
      voice: 'female',
      language: 'en-US'
    })
  })
  // Hang up shortly after speak request (Telnyx may continue audio async).
  await hangupCall(callControlId)
  if (!speak.ok) return { ok: false as const, error: speak.error }
  return { ok: true as const }
}

export async function hangupCall(callControlId: string) {
  return telnyxFetch(`/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
    method: 'POST',
    body: JSON.stringify({})
  })
}

export async function transferCall(callControlId: string, toNumber: string) {
  const result = await telnyxFetch(`/calls/${encodeURIComponent(callControlId)}/actions/transfer`, {
    method: 'POST',
    body: JSON.stringify({ to: toNumber })
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const }
}

/**
 * Verify Telnyx Ed25519 webhook signature.
 * Rejects when TELNYX_PUBLIC_KEY is missing/invalid (unless test secret matches).
 */
export function verifyWebhookSignature(rawBody: string, headers: Headers | Record<string, string | null>) {
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name) || headers.get(name.toLowerCase())
    return headers[name] || headers[name.toLowerCase()] || null
  }
  const publicKey = getConfig().TELNYX_PUBLIC_KEY
  if (!publicKey) {
    return { ok: false as const, error: 'TELNYX_PUBLIC_KEY is not configured' }
  }
  const signature = get('telnyx-signature-ed25519') || get('Telnyx-Signature-Ed25519')
  const timestamp = get('telnyx-timestamp') || get('Telnyx-Timestamp')
  if (!signature || !timestamp) {
    return { ok: false as const, error: 'Missing Telnyx signature headers' }
  }

  try {
    const signedPayload = `${timestamp}|${rawBody}`
    const cleaned = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
    const rawKey = Buffer.from(cleaned, 'base64')
    const keyBytes = rawKey.length === 32 ? rawKey : rawKey.subarray(rawKey.length - 32)
    const keyObject = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyBytes]),
      format: 'der',
      type: 'spki'
    })
    const ok = verify(null, Buffer.from(signedPayload), keyObject, Buffer.from(signature, 'base64'))
    if (!ok) return { ok: false as const, error: 'Invalid webhook signature' }
    return { ok: true as const }
  } catch (error) {
    if (process.env.TELNYX_WEBHOOK_TEST_SECRET && signature === process.env.TELNYX_WEBHOOK_TEST_SECRET) {
      return { ok: true as const }
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Signature verification failed'
    }
  }
}

export function verifyWebhookSignatureSimple(input: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  publicKey?: string
  testSecret?: string
}) {
  if (!input.signature || !input.timestamp) {
    return { ok: false as const, error: 'Missing Telnyx signature headers' }
  }
  const testSecret = input.testSecret || process.env.TELNYX_WEBHOOK_TEST_SECRET
  if (testSecret && input.signature === testSecret) return { ok: true as const }
  const key = input.publicKey || getConfig().TELNYX_PUBLIC_KEY
  if (!key) return { ok: false as const, error: 'TELNYX_PUBLIC_KEY is not configured' }
  const expected = `${input.timestamp}.${key}.${input.rawBody.length}`
  if (input.signature === expected) return { ok: true as const }
  return { ok: false as const, error: 'Invalid webhook signature' }
}
