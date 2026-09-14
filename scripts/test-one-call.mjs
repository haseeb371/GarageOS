/**
 * Place ONE outbound Telnyx AI test call (bypasses DIALER_ENABLED).
 *
 * Usage:
 *   node scripts/test-one-call.mjs +15551234567
 *
 * Loads .env.local. Resolves lead + shop from DB when possible so /leads tracks it.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'

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

const digits = to.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
let leadId = 'TEST-CALL'
let shopId =
  process.env.LEADS_IMPORT_SHOP_ID ||
  process.env.DEFAULT_SHOP_ID ||
  '76f75bda-0d92-4420-8047-756829b8e241'
let businessName = ''

if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
  try {
    const rows = await sql`
      SELECT id, shop_id, business_name
      FROM sales_leads
      WHERE phone_digits = ${digits} OR phone LIKE ${'%' + digits.slice(-10) + '%'}
      ORDER BY updated_at DESC
      LIMIT 1
    `
    if (rows[0]) {
      leadId = rows[0].id
      shopId = rows[0].shop_id
      businessName = rows[0].business_name
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const greeting =
  'Hi — this is an automated assistant calling from AutoGaragify. Did I catch you for thirty seconds?'
const clientState = Buffer.from(
  JSON.stringify({
    leadId,
    shopId,
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

console.log(`Placing test call: ${from} → ${to}${businessName ? ` (${businessName})` : ''}`)
console.log(`Tracking lead=${leadId} shop=${shopId}`)
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
const callControlId = call.call_control_id || call.id || ''
const now = Date.now()

if (process.env.DATABASE_URL && callControlId) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
  try {
    await sql`
      INSERT INTO contact_logs (
        shop_id, lead_id, actor_id, outcome, detail, direction, telnyx_call_id,
        status, transcript, recording_url, duration_seconds, ai_disclosure, ended_at, created_at, updated_at
      ) VALUES (
        ${shopId}, ${leadId === 'TEST-CALL' ? null : leadId}, 'manual-test', 'dialing',
        ${`Manual test call · ${to}${businessName ? ` · ${businessName}` : ''}`},
        'outbound', ${callControlId}, 'dialing', ${JSON.stringify([])}::jsonb, null, null, true, null, ${now}, ${now}
      )
    `
    if (leadId !== 'TEST-CALL') {
      await sql`
        UPDATE sales_leads
        SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
            last_contacted_at = ${now},
            attempts = COALESCE(attempts, 0) + 1,
            updated_at = ${now}
        WHERE id = ${leadId}
      `
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

console.log({
  ok: true,
  callControlId,
  callSessionId: call.call_session_id,
  to,
  from,
  leadId,
  businessName: businessName || null,
  greeting,
  note: 'After hangup, refresh /leads — Recent calls + View transcript.'
})
