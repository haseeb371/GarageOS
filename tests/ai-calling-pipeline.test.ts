import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearRuntimeOverridesForTests,
  isDialerEnabled,
  isDryRun,
  loadConfig,
  resetConfigWarnForTests
} from '../lib/config'
import { evaluateDialerLead, runDialerGuards, resetActiveDialsForTests } from '../lib/dialerGuards'
import { buildDryRunContactLog, shouldSkipTelnyxCall } from '../lib/dialerDryRun'
import { assertOutboundDisclosure, hasAiDisclosure } from '../lib/aiAgent/transcript'
import { loadSystemPrompt } from '../lib/aiAgent/prompt'
import { answerWithUnavailableTts } from '../lib/telnyx'

test('config defaults: dialer off, daily cap 20, dry-run false, prompt v1', () => {
  resetConfigWarnForTests()
  clearRuntimeOverridesForTests()
  const cfg = loadConfig({
    ...process.env,
    DIALER_ENABLED: undefined,
    DIALER_DAILY_CAP: undefined,
    DIALER_DRY_RUN: undefined,
    DIALER_MAX_CONCURRENT: undefined,
    AI_PROMPT_VERSION: undefined,
    US_STATE_BLOCKLIST: undefined
  } as NodeJS.ProcessEnv)
  assert.equal(cfg.DIALER_ENABLED, false)
  assert.equal(cfg.DIALER_DAILY_CAP, 20)
  assert.equal(cfg.DIALER_DRY_RUN, false)
  assert.equal(cfg.DIALER_MAX_CONCURRENT, 5)
  assert.equal(cfg.AI_PROMPT_VERSION, 'v1')
  assert.deepEqual(cfg.US_STATE_BLOCKLIST, [])
  assert.equal(isDialerEnabled({ ...process.env, DIALER_ENABLED: 'false' }), false)
  assert.equal(isDryRun({ ...process.env, DIALER_DRY_RUN: 'true' }), true)
})

test('dry-run dialer skips Telnyx and builds dry_run contact log', () => {
  assert.equal(shouldSkipTelnyxCall(true), true)
  assert.equal(shouldSkipTelnyxCall(false), false)
  const row = buildDryRunContactLog({
    shopId: 'SHOP',
    leadId: 'L1',
    to: '+15125550100',
    campaign: 'austin',
    now: 1000
  })
  assert.equal(row.outcome, 'dry_run')
  assert.equal(row.status, 'dry_run')
  assert.match(row.detail, /DRY RUN would dial/)
})

test('missing assistant fallback speaks unavailable and hangs up', async () => {
  const original = globalThis.fetch
  const paths: string[] = []
  process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'KEY_TEST'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    paths.push(String(input))
    const body = String(init?.body || '')
    if (String(input).includes('/actions/speak')) {
      assert.match(body, /AutoGaragify is not available right now/)
    }
    return new Response(JSON.stringify({ data: { result: 'ok' } }), { status: 200 })
  }) as typeof fetch
  try {
    const result = await answerWithUnavailableTts('CALL_UNAVAIL')
    assert.equal(result.ok, true)
    assert.ok(paths.some(p => p.includes('/actions/answer')))
    assert.ok(paths.some(p => p.includes('/actions/speak')))
    assert.ok(paths.some(p => p.includes('/actions/hangup')))
  } finally {
    globalThis.fetch = original
  }
})

test('compliance violation on missing AI disclosure', () => {
  assert.equal(hasAiDisclosure('Hello, is the owner there?'), false)
  assert.equal(hasAiDisclosure('This is an automated call from AutoGaragify'), true)
  assert.equal(hasAiDisclosure('Hi, this is an AI assistant'), true)
  const bad = assertOutboundDisclosure([{ role: 'assistant', text: 'Hey there', at: 1 }])
  assert.equal(bad.ok, false)
})

test('dnc_phones and state blocklist block dialer', () => {
  resetActiveDialsForTests()
  const env = { ...process.env, DIALER_ENABLED: 'true', US_STATE_BLOCKLIST: 'CA,FL' }
  const dnc = evaluateDialerLead(
    {
      id: 'L1',
      status: 'new',
      phoneDigits: '5125551212',
      address: 'Austin TX',
      lastContactedAt: null,
      retryAfter: null,
      attempts: 0
    },
    { env, activeCount: 0, dailyCount: 0, dncDigits: new Set(['5125551212']) }
  )
  assert.equal(dnc.ok, false)
  if (!dnc.ok) assert.equal(dnc.reason, 'dnc_phones')

  const blocked = runDialerGuards(
    {
      id: 'L2',
      status: 'new',
      phoneDigits: '4155551212',
      address: '1 Market St, San Francisco, CA 94105',
      lastContactedAt: null,
      retryAfter: null,
      attempts: 0
    },
    { env, activeCount: 0, dailyCount: 0 }
  )
  assert.equal(blocked.ok, false)
  assert.ok(blocked.checks.some(c => c.check === 'state_blocklist' && c.result === 'fail'))
})

test('prompt version falls back to v1 when missing', () => {
  const loaded = loadSystemPrompt('v999-does-not-exist')
  assert.equal(loaded.version, 'v1')
  assert.equal(loaded.fallback, true)
  assert.match(loaded.text, /AutoGaragify/)
})
