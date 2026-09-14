/** Pure dialing guardrails used by Call + tests (no DB). */

export const MAX_ACTIVE_DIALS = 5
export const MIN_HOURS_BETWEEN_CONTACTS = 24

const activeDialIds = new Set<string>()

export function getActiveDialCount() {
  return activeDialIds.size
}

export function trackDialStart(callId: string) {
  activeDialIds.add(callId)
}

export function trackDialEnd(callId: string) {
  activeDialIds.delete(callId)
}

/** Test helper — clear in-memory active dial set. */
export function resetActiveDialsForTests() {
  activeDialIds.clear()
}

export type DialGuardInput = {
  status: string
  lastContactedAt: number | null | undefined
  now?: number
  activeCount?: number
}

export type DialGuardResult =
  | { ok: true }
  | { ok: false; code: 'do_not_call' | 'cooldown' | 'rate_limit'; error: string }

export function assertCanDialLead(input: DialGuardInput): DialGuardResult {
  if (input.status === 'do_not_call') {
    return { ok: false, code: 'do_not_call', error: 'Lead is marked Do Not Call.' }
  }

  const now = input.now ?? Date.now()
  const last = input.lastContactedAt
  if (last && now - last < MIN_HOURS_BETWEEN_CONTACTS * 60 * 60 * 1000) {
    return {
      ok: false,
      code: 'cooldown',
      error: `Lead was contacted within the last ${MIN_HOURS_BETWEEN_CONTACTS} hours.`
    }
  }

  const active = input.activeCount ?? getActiveDialCount()
  if (active >= MAX_ACTIVE_DIALS) {
    return {
      ok: false,
      code: 'rate_limit',
      error: `Too many active calls (${active}/${MAX_ACTIVE_DIALS}). Try again shortly.`
    }
  }

  return { ok: true }
}
