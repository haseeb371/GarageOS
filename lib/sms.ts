import type { SmsCreds } from './providerCredentials'
import { resolveSmsCreds } from './providerCredentials'

export type SmsPayload = {
  to: string
  body: string
}

export function smsConfigured(creds?: SmsCreds | null) {
  const resolved = creds || resolveSmsCreds()
  return Boolean(resolved.accountSid && resolved.authToken && resolved.from)
}

export function smsFromNumber(creds?: SmsCreds | null) {
  return (creds || resolveSmsCreds()).from
}

export function smsAccountSid(creds?: SmsCreds | null) {
  return (creds || resolveSmsCreds()).accountSid
}

/** Prefer E.164 (+15551234567). 10-digit numbers default to +1 for US Twilio trials. */
export function normalizePhone(input: string) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '')
    return digits ? `+${digits}` : ''
  }
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits ? `+${digits}` : ''
}

export function smsSetupChecklist(creds?: SmsCreds | null) {
  const resolved = creds || resolveSmsCreds()
  const sid = resolved.accountSid
  const token = Boolean(resolved.authToken)
  const from = resolved.from
  const fromOk = Boolean(normalizePhone(from))
  const configured = Boolean(sid && token && fromOk)

  return {
    configured,
    from,
    sidMasked: sid ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : '',
    steps: [
      {
        id: 'sid',
        label: 'Twilio Account SID',
        done: Boolean(sid),
        detail: sid
          ? `Looks like ${sid.startsWith('AC') ? 'Account SID' : 'unexpected format'} (${sid.slice(0, 4)}…)`
          : 'Paste in Ops, or set TWILIO_ACCOUNT_SID'
      },
      {
        id: 'token',
        label: 'Twilio Auth Token',
        done: token,
        detail: token ? 'Present (shop settings or .env.local)' : 'Console → Account info → Auth Token'
      },
      {
        id: 'from',
        label: 'Twilio phone (E.164)',
        done: fromOk,
        detail: fromOk
          ? `From ${normalizePhone(from)}`
          : 'Buy/get a number in Twilio. Use +countrycode… (e.g. +15551234567)'
      },
      {
        id: 'trial',
        label: 'Trial: verify destination numbers',
        done: false,
        detail:
          'Twilio trial accounts can only SMS verified numbers (Console → Phone Numbers → Verified Caller IDs). Upgrade to send to any customer.'
      }
    ],
    setup: [
      'Sign up at https://www.twilio.com/try-twilio (complete MFA if prompted)',
      'Console → copy Account SID + Auth Token',
      'Phone Numbers → Buy/Get a number',
      'Paste all three in Ops → Support & compliance (or .env.local)',
      'Trial: Verified Caller IDs → add your personal phone for tests',
      'Use Send test SMS'
    ]
  }
}

export function interpretTwilioError(
  status: number,
  result: { message?: string; error_message?: string; code?: number }
) {
  const code = Number(result.code || 0)
  const message = String(result.error_message || result.message || '').trim()

  if (status === 401 || code === 20003) {
    return 'Twilio rejected the credentials. Update Account SID and Auth Token in Ops → Support & compliance.'
  }
  if (code === 21211 || code === 21214) {
    return `${message || 'Invalid phone number.'} Use E.164 with country code (e.g. +15551234567).`
  }
  if (code === 21606 || code === 21608 || message.toLowerCase().includes('unverified')) {
    return `${message || 'Trial restriction.'} Twilio trial can only text Verified Caller IDs. Verify the destination number in the Twilio Console, or upgrade the account.`
  }
  if (code === 21610) {
    return `${message || 'Recipient opted out (STOP).'} Remove them from campaigns or wait for them to reply START.`
  }
  if (code === 21408 || message.toLowerCase().includes('permission') || message.toLowerCase().includes('geo')) {
    return `${message || 'Geographic permission blocked.'} Enable the destination country under Twilio Messaging Geo Permissions.`
  }
  if (status === 429) {
    return 'Twilio rate limit hit. Wait a moment and try again.'
  }

  return message || `Twilio returned ${status}${code ? ` (${code})` : ''}.`
}

export async function sendSms(payload: SmsPayload, creds?: SmsCreds | null) {
  const resolved = creds || resolveSmsCreds()
  if (!resolved.accountSid || !resolved.authToken || !resolved.from) {
    return {
      ok: false as const,
      sandbox: true as const,
      error: 'Add Twilio Account SID, Auth Token, and phone number in Ops → Support & compliance (or .env.local).'
    }
  }

  const to = normalizePhone(payload.to)
  if (!to) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: 'A valid recipient phone number is required (include country code, e.g. +1…).'
    }
  }

  const body = String(payload.body || '').trim()
  if (!body) {
    return { ok: false as const, sandbox: false as const, error: 'SMS message body is required.' }
  }

  const fromRaw = resolved.from
  const from = normalizePhone(fromRaw) || fromRaw
  if (!from.startsWith('+')) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: `Twilio phone must be E.164 (start with +). Current value looks invalid: ${fromRaw || '(empty)'}`
    }
  }

  const auth = Buffer.from(`${resolved.accountSid}:${resolved.authToken}`).toString('base64')
  const form = new URLSearchParams({ To: to, From: from, Body: body })

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${resolved.accountSid}/Messages.json`, {
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
    code?: number
  }

  if (!response.ok) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: interpretTwilioError(response.status, result)
    }
  }

  return { ok: true as const, sandbox: false as const, id: result.sid || '', to }
}
