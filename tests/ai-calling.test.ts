import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateDialerLead,
  isDialerEnabled,
  parseStateFromAddress,
  resetActiveDialsForTests,
  usStateBlocklist
} from '../lib/dialerGuards'
import { assertOutboundDisclosure, detectDncIntent, hasAiDisclosure } from '../lib/aiAgent/transcript'
import { markDncPlan } from '../lib/aiAgent/toolPlans'
import { verifyWebhookSignatureSimple, transferCall } from '../lib/telnyx'
import { rememberWebhookEvent, resetWebhookIdempotencyForTests } from '../lib/webhookIdempotency'
import { normalizeUsPhone, e164FromStoredPhone } from '../lib/leads'
import { OUTBOUND_GREETING } from '../lib/aiAgent/prompt'

const baseLead = {
  id: 'L1',
  status: 'new',
  phoneDigits: '5551234567',
  address: '100 Main St, Austin, TX 78701',
  lastContactedAt: null as number | null,
  retryAfter: null as number | null,
  attempts: 0
}

test('dialer honors DIALER_ENABLED=false', () => {
  const env = { ...process.env, DIALER_ENABLED: 'false' }
  assert.equal(isDialerEnabled(env), false)
  const result = evaluateDialerLead(baseLead, { env, activeCount: 0, dailyCount: 0 })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /DIALER_ENABLED/)
})

test('dialer skips DNC leads and dnc_phones matches', () => {
  const env = { ...process.env, DIALER_ENABLED: 'true' }
  const dnc = evaluateDialerLead({ ...baseLead, status: 'do_not_call' }, { env, activeCount: 0 })
  assert.equal(dnc.ok, false)
  if (!dnc.ok) assert.equal(dnc.reason, 'do_not_call')

  const listed = evaluateDialerLead(baseLead, {
    env,
    activeCount: 0,
    dncDigits: new Set(['5551234567'])
  })
  assert.equal(listed.ok, false)
  if (!listed.ok) assert.equal(listed.reason, 'dnc_phones')
})

test('dialer skips leads contacted in last 24h', () => {
  const env = { ...process.env, DIALER_ENABLED: 'true' }
  const now = Date.now()
  const result = evaluateDialerLead(
    { ...baseLead, lastContactedAt: now - 60 * 60 * 1000 },
    { env, now, activeCount: 0 }
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'cooldown')
})

test('dialer skips retry_after and state-blocked leads', () => {
  const env = {
    ...process.env,
    DIALER_ENABLED: 'true',
    US_STATE_BLOCKLIST: 'CA,FL'
  }
  assert.deepEqual(usStateBlocklist(env), ['CA', 'FL'])
  assert.equal(parseStateFromAddress('9 Market St, San Francisco, CA 94103'), 'CA')

  const retry = evaluateDialerLead(
    { ...baseLead, retryAfter: Date.now() + 60_000 },
    { env: { ...process.env, DIALER_ENABLED: 'true' }, activeCount: 0 }
  )
  assert.equal(retry.ok, false)
  if (!retry.ok) assert.equal(retry.reason, 'retry_after')

  const blocked = evaluateDialerLead(
    { ...baseLead, address: '1 Market St, San Francisco, CA 94105' },
    { env, activeCount: 0 }
  )
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.match(blocked.reason, /state_blocklist:CA/)
})

test('webhook rejects unsigned requests (401 path)', () => {
  const missing = verifyWebhookSignatureSimple({
    rawBody: '{}',
    signature: null,
    timestamp: null,
    publicKey: 'test-key'
  })
  assert.equal(missing.ok, false)

  const bad = verifyWebhookSignatureSimple({
    rawBody: '{}',
    signature: 'nope',
    timestamp: '1',
    publicKey: 'test-key'
  })
  assert.equal(bad.ok, false)
})

test('webhook is idempotent on duplicate event IDs', () => {
  resetWebhookIdempotencyForTests()
  assert.equal(rememberWebhookEvent('evt-1'), true)
  assert.equal(rememberWebhookEvent('evt-1'), false)
  assert.equal(rememberWebhookEvent('evt-2'), true)
})

test('transfer_to_human triggers Telnyx transfer call', async () => {
  const original = globalThis.fetch
  let calledUrl = ''
  let calledBody = ''
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input)
    calledBody = String(init?.body || '')
    return new Response(JSON.stringify({ data: { result: 'ok' } }), { status: 200 })
  }) as typeof fetch

  process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'KEY_TEST'
  try {
    const result = await transferCall('CALL123', '+15559876543')
    assert.equal(result.ok, true)
    assert.match(calledUrl, /\/v2\/calls\/CALL123\/actions\/transfer/)
    assert.match(calledBody, /\+15559876543/)
  } finally {
    globalThis.fetch = original
  }
})

test('mark_dnc plan adds dnc_phones digits and updates lead status', () => {
  const plan = markDncPlan({ shopId: 'SHOP1', leadId: 'LEAD1', phoneDigits: '5125551212' })
  assert.equal(plan.leadUpdate.status, 'do_not_call')
  assert.equal(plan.dncInsert?.phoneDigits, '5125551212')
  assert.equal(plan.dncInsert?.shopId, 'SHOP1')
})

test('transcript parser flags missing AI disclosure as compliance_violation', () => {
  assert.equal(hasAiDisclosure(OUTBOUND_GREETING), true)
  const ok = assertOutboundDisclosure([
    { role: 'assistant', text: OUTBOUND_GREETING, at: 1 }
  ])
  assert.equal(ok.ok, true)

  const bad = assertOutboundDisclosure([
    { role: 'assistant', text: 'Hey, is the owner there?', at: 1 }
  ])
  assert.equal(bad.ok, false)
  assert.equal(detectDncIntent("Please don't call me again"), true)
})

test('phone normalization edge cases for dialer E.164', () => {
  assert.equal(normalizeUsPhone('(512) 555-0199').ok, true)
  assert.equal(e164FromStoredPhone('(512) 555-0199'), '+15125550199')
  assert.equal(e164FromStoredPhone('15125550199'), '+15125550199')
  assert.equal(normalizeUsPhone('512555').ok, false)
  assert.equal(normalizeUsPhone('+44 20 7946 0958').ok, false)
})

test('empty US_STATE_BLOCKLIST is still read (enforced, none blocked)', () => {
  resetActiveDialsForTests()
  const env = { ...process.env, DIALER_ENABLED: 'true', US_STATE_BLOCKLIST: '' }
  assert.deepEqual(usStateBlocklist(env), [])
  const result = evaluateDialerLead(baseLead, { env, activeCount: 0, dailyCount: 0 })
  assert.equal(result.ok, true)
})
