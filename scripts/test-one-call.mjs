/**
 * Place ONE outbound Telnyx AI test call (bypasses DIALER_ENABLED).
 *
 * Usage:
 *   node scripts/test-one-call.mjs +15551234567
 *
 * Loads .env.local. Does not enable the campaign dialer.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function loadEnvFile(name) {
  const path = join(process.cwd(), name)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

const toRaw = process.argv[2] || ''
const to = toRaw.replace(/[^\d+]/g, '')
if (!to.startsWith('+') || to.length < 11) {
  console.error('Usage: node scripts/test-one-call.mjs +15551234567')
  process.exit(1)
}

const apiKey = process.env.TELNYX_API_KEY
const connectionId = process.env.TELNYX_CONNECTION_ID
const from = process.env.TELNYX_FROM_NUMBER
const assistantId = process.env.TELNYX_ASSISTANT_ID
const base = (process.env.APP_URL || 'https://autogaragify.com').replace(/\/$/, '')

if (!apiKey || !connectionId || !from) {
  console.error('Missing TELNYX_API_KEY, TELNYX_CONNECTION_ID, or TELNYX_FROM_NUMBER in .env.local')
  process.exit(1)
}
if (!assistantId) {
  console.error('Missing TELNYX_ASSISTANT_ID — run register-assistant first')
  process.exit(1)
}

const greeting =
  'Hi, this is an automated assistant calling from AutoGaragify — is the owner or manager available for a quick minute?'
const clientState = Buffer.from(
  JSON.stringify({
    leadId: 'TEST-CALL',
    shopId: process.env.DEFAULT_SHOP_ID || '',
    campaign: 'manual-test',
    direction: 'outbound'
  }),
  'utf8'
).toString('base64')

const body = {
  connection_id: connectionId,
  to,
  from,
  webhook_url: `${base}/api/telnyx/webhook`,
  webhook_url_method: 'POST',
  answering_machine_detection: 'detect',
  client_state: clientState,
  assistant: {
    id: assistantId,
    greeting
  }
}

console.log(`Placing test call: ${from} → ${to}`)
const res = await fetch('https://api.telnyx.com/v2/calls', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  },
  body: JSON.stringify(body)
})
const data = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error('Telnyx error:', data?.errors?.[0]?.detail || data?.message || res.status)
  console.error(JSON.stringify(data, null, 2))
  process.exit(1)
}

const call = data.data || {}
console.log({
  ok: true,
  callControlId: call.call_control_id,
  callSessionId: call.call_session_id,
  to,
  from,
  greeting,
  note: 'Answer your phone. After hangup, check /leads or contact_logs for transcript.'
})
