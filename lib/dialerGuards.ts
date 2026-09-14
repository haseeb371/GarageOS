/** Dialer eligibility + env guards (pure where possible). */

import {
  assertCanDialLead,
  getActiveDialCount,
  MAX_ACTIVE_DIALS,
  MIN_HOURS_BETWEEN_CONTACTS
} from '@/lib/leadDialGuard'
import { getBlockedStates, isDialerEnabled, loadConfig } from '@/lib/config'

export {
  getActiveDialCount,
  trackDialStart,
  trackDialEnd,
  resetActiveDialsForTests,
  MAX_ACTIVE_DIALS
} from '@/lib/leadDialGuard'

export function dialerMaxConcurrent(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(env).DIALER_MAX_CONCURRENT || MAX_ACTIVE_DIALS
}

export function dialerDailyCap(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(env).DIALER_DAILY_CAP
}

export function usStateBlocklist(env: NodeJS.ProcessEnv = process.env): string[] {
  return getBlockedStates(env)
}

export { isDialerEnabled }

/** Extract US state code from a freeform address when possible. */
export function parseStateFromAddress(address: string): string {
  const text = String(address || '')
  const match = text.match(/\b([A-Z]{2})\s+\d{5}(-\d{4})?\b/) || text.match(/,\s*([A-Z]{2})\b/)
  return match?.[1]?.toUpperCase() || ''
}

export type DialerLeadLike = {
  id: string
  status: string
  phoneDigits: string
  address: string
  lastContactedAt?: number | null
  retryAfter?: number | null
  attempts?: number | null
}

export type DialGuardCheck = {
  check: string
  lead_id: string
  result: 'pass' | 'fail'
  reason?: string
}

/** Run all outbound guards and return structured check log + overall ok. */
export function runDialerGuards(
  lead: DialerLeadLike,
  opts: {
    now?: number
    activeCount?: number
    dailyCount?: number
    dncDigits?: Set<string>
    env?: NodeJS.ProcessEnv
  } = {}
): { ok: boolean; checks: DialGuardCheck[]; reason?: string } {
  const env = opts.env || process.env
  const cfg = loadConfig(env)
  const now = opts.now ?? Date.now()
  const active = opts.activeCount ?? getActiveDialCount()
  const daily = opts.dailyCount || 0
  const checks: DialGuardCheck[] = []
  const leadId = lead.id

  const add = (check: string, pass: boolean, reason?: string) => {
    checks.push({
      check,
      lead_id: leadId,
      result: pass ? 'pass' : 'fail',
      reason: pass ? undefined : reason
    })
    return pass
  }

  let ok = true
  ok = add('DIALER_ENABLED', cfg.DIALER_ENABLED, 'DIALER_ENABLED=false') && ok
  ok = add('status_not_dnc', lead.status !== 'do_not_call', 'do_not_call') && ok
  ok =
    add(
      'not_in_dnc_phones',
      !opts.dncDigits?.has(lead.phoneDigits),
      'dnc_phones'
    ) && ok
  const cooldownOk =
    !lead.lastContactedAt || now - lead.lastContactedAt >= MIN_HOURS_BETWEEN_CONTACTS * 60 * 60 * 1000
  ok = add('cooldown_24h', cooldownOk, 'cooldown') && ok
  ok =
    add(
      'retry_after',
      !lead.retryAfter || lead.retryAfter <= now,
      'retry_after'
    ) && ok
  const state = parseStateFromAddress(lead.address)
  const block = cfg.US_STATE_BLOCKLIST
  ok =
    add(
      'state_blocklist',
      !(state && block.includes(state)),
      state ? `state_blocklist:${state}` : 'state_blocklist'
    ) && ok
  ok = add('attempts_lt_3', (lead.attempts || 0) < 3, 'max_attempts') && ok
  ok =
    add(
      'max_concurrent',
      active < cfg.DIALER_MAX_CONCURRENT,
      `active_cap:${active}/${cfg.DIALER_MAX_CONCURRENT}`
    ) && ok
  ok =
    add(
      'daily_cap',
      daily < cfg.DIALER_DAILY_CAP,
      `daily_cap:${daily}/${cfg.DIALER_DAILY_CAP}`
    ) && ok

  const failed = checks.find(c => c.result === 'fail')
  return { ok, checks, reason: failed?.reason }
}

export function evaluateDialerLead(
  lead: DialerLeadLike,
  opts: {
    now?: number
    activeCount?: number
    dailyCount?: number
    dncDigits?: Set<string>
    env?: NodeJS.ProcessEnv
  } = {}
): { ok: true } | { ok: false; reason: string } {
  const result = runDialerGuards(lead, opts)
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.reason || 'blocked' }
}

export { MIN_HOURS_BETWEEN_CONTACTS }

// keep assertCanDialLead available for older callers
void assertCanDialLead
