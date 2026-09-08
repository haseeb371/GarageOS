import type { EmailCreds } from './providerCredentials'
import { resolveEmailCreds } from './providerCredentials'

export type EmailPayload = {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

function fromAddress(from: string) {
  const match = from.match(/<([^>]+)>/)
  return (match?.[1] || from).trim().toLowerCase()
}

function fromDomain(from: string) {
  const address = fromAddress(from)
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1) : ''
}

function isOnboarding(from: string) {
  const domain = fromDomain(from)
  return domain === 'resend.dev' || fromAddress(from).endsWith('@resend.dev')
}

export function emailConfigured(creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  return Boolean(resolved.apiKey && resolved.from)
}

export function emailFrom(creds?: EmailCreds | null) {
  return (creds || resolveEmailCreds()).from
}

export function emailFromAddress(creds?: EmailCreds | null) {
  return fromAddress(emailFrom(creds))
}

export function emailFromDomain(creds?: EmailCreds | null) {
  return fromDomain(emailFrom(creds))
}

export function emailIsResendOnboarding(creds?: EmailCreds | null) {
  return isOnboarding(emailFrom(creds))
}

export function emailSetupChecklist(creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  const key = Boolean(resolved.apiKey)
  const from = resolved.from
  const domain = fromDomain(from)
  const onboarding = isOnboarding(from)
  const configured = Boolean(key && from)

  return {
    configured,
    from,
    domain,
    testingMode: onboarding,
    steps: [
      {
        id: 'api-key',
        label: 'Resend API key',
        done: key,
        detail: key ? 'Present (shop settings or .env.local)' : 'Paste in Ops → Support & compliance, or set RESEND_API_KEY'
      },
      {
        id: 'from',
        label: 'From address',
        done: Boolean(from),
        detail: from || 'Example: AutoGaragify <onboarding@resend.dev> for testing'
      },
      {
        id: 'domain',
        label: onboarding ? 'Using Resend test sender' : 'Custom domain in From',
        done: Boolean(domain),
        detail: onboarding
          ? 'onboarding@resend.dev can only send to your Resend account email until a domain is verified.'
          : `From domain: ${domain}. Verify this domain in Resend (DNS SPF/DKIM) before sending to customers.`
      },
      {
        id: 'production',
        label: 'Production domain verified',
        done: configured && !onboarding,
        detail: onboarding
          ? 'Add your domain in Resend → Domains, add DNS at your DNS host, then set From to an address on that domain.'
          : 'Custom from-address configured. Confirm the domain shows Verified in the Resend dashboard.'
      }
    ],
    setup: [
      'Sign up at https://resend.com and create an API key',
      'Paste the key + From address in Ops (or .env.local)',
      'For quick tests: AutoGaragify <onboarding@resend.dev> (only emails your Resend login)',
      'For customers: Resend → Domains → Add domain → copy DNS to Cloudflare/Namecheap/etc.',
      'When Verified, set From to Your Shop <service@your-domain.com>',
      'Use Send test email'
    ]
  }
}

export function interpretResendError(
  status: number,
  body: { message?: string; name?: string },
  creds?: EmailCreds | null
) {
  const message = String(body.message || body.name || '').trim()
  const lower = message.toLowerCase()
  const domain = emailFromDomain(creds)

  if (status === 401 || lower.includes('api key') || lower.includes('unauthorized')) {
    return 'Resend rejected the API key. Update it in Ops → Support & compliance (or RESEND_API_KEY).'
  }

  if (
    lower.includes('domain') ||
    lower.includes('not verified') ||
    lower.includes('from address') ||
    lower.includes('invalid from')
  ) {
    return `${message || 'From address/domain not allowed.'} Verify the domain for ${domain || 'your From address'} in Resend, or temporarily use onboarding@resend.dev for self-tests only.`
  }

  if (lower.includes('only send') || lower.includes('testing emails') || lower.includes('own email')) {
    return `${message} While using onboarding@resend.dev, Resend only delivers to your Resend account email. Verify a domain to email customers.`
  }

  if (status === 403) {
    return message || 'Resend forbidden this send. Usually the from-domain is unverified or the recipient is blocked in test mode.'
  }

  if (status === 429) {
    return 'Resend rate limit hit. Wait a minute and try again.'
  }

  return message || `Resend returned ${status}.`
}

export async function sendEmail(payload: EmailPayload, creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  if (!resolved.apiKey || !resolved.from) {
    return {
      ok: false as const,
      sandbox: true as const,
      error: 'Add a Resend API key and From address in Ops → Support & compliance (or .env.local).'
    }
  }

  const to = Array.isArray(payload.to) ? payload.to : [payload.to]
  const recipients = to.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
  if (!recipients.length) {
    return { ok: false as const, sandbox: false as const, error: 'A recipient email address is required.' }
  }

  if (isOnboarding(resolved.from) && recipients.length > 1) {
    return {
      ok: false as const,
      sandbox: false as const,
      error:
        'From uses onboarding@resend.dev (test mode). Resend only allows sending to your own account email until you verify a custom domain.'
    }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolved.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: resolved.from,
      to: recipients,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    })
  })

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
  if (!response.ok) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: interpretResendError(response.status, body, resolved)
    }
  }

  return {
    ok: true as const,
    sandbox: false as const,
    id: body.id || '',
    testingMode: isOnboarding(resolved.from)
  }
}
