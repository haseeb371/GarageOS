import { createTransport } from 'nodemailer'
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

function fromName(from: string) {
  const match = from.match(/^(.*)<([^>]+)>$/)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : ''
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
  if (resolved.provider === 'smtp') return Boolean(resolved.from && process.env.SMTP_USER && process.env.SMTP_PASS)
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
  const resolved = creds || resolveEmailCreds()
  return resolved.provider === 'resend' && isOnboarding(resolved.from)
}

export function emailProviderLabel(creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  if (resolved.provider === 'sendgrid') return 'SendGrid'
  if (resolved.provider === 'smtp') return 'SMTP'
  if (resolved.provider === 'resend') return 'Resend'
  return 'Email'
}

export function emailSetupChecklist(creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  const key = Boolean(resolved.apiKey) || resolved.provider === 'smtp'
  const from = resolved.from
  const domain = fromDomain(from)
  const onboarding = emailIsResendOnboarding(resolved)
  const configured = emailConfigured(resolved)
  const provider = emailProviderLabel(resolved)

  return {
    configured,
    from,
    domain,
    testingMode: onboarding,
    provider: resolved.provider || '',
    steps: [
      {
        id: 'api-key',
        label: `${provider} credentials`,
        done: key,
        detail: key
          ? `Using ${provider}`
          : 'Set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_USER/SMTP_PASS'
      },
      {
        id: 'from',
        label: 'From address',
        done: Boolean(from),
        detail: from || 'Set EMAIL_FROM or FROM_NAME + FROM_EMAIL'
      },
      {
        id: 'domain',
        label: onboarding ? 'Using Resend test sender' : `From domain (${domain || 'unset'})`,
        done: Boolean(domain),
        detail: onboarding
          ? 'onboarding@resend.dev can only send to your Resend account email.'
          : `From domain: ${domain || '—'}`
      },
      {
        id: 'production',
        label: 'Ready to send',
        done: configured && !onboarding,
        detail: configured
          ? `${provider} configured for ${from}`
          : 'Add provider credentials and a From address.'
      }
    ],
    setup: [
      'Preferred: RESEND_API_KEY or SENDGRID_API_KEY + FROM_EMAIL/FROM_NAME',
      'Fallback: SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_PORT',
      'Shop Ops can still paste Resend keys per shop',
      'Use Send test email in Ops'
    ]
  }
}

export function interpretResendError(
  status: number,
  body: { message?: string; name?: string; errors?: Array<{ message?: string }> },
  creds?: EmailCreds | null
) {
  const message = String(body.message || body.name || body.errors?.[0]?.message || '').trim()
  const lower = message.toLowerCase()
  const domain = emailFromDomain(creds)

  if (status === 401 || lower.includes('api key') || lower.includes('unauthorized')) {
    return 'Email provider rejected the API key. Check RESEND_API_KEY or SENDGRID_API_KEY.'
  }

  if (
    lower.includes('domain') ||
    lower.includes('not verified') ||
    lower.includes('from address') ||
    lower.includes('invalid from')
  ) {
    return `${message || 'From address/domain not allowed.'} Verify ${domain || 'your From domain'} with the email provider.`
  }

  if (status === 403) {
    return message || 'Email provider forbidden this send.'
  }

  if (status === 429) {
    return 'Email rate limit hit. Wait a minute and try again.'
  }

  return message || `Email provider returned ${status}.`
}

async function sendWithResend(payload: EmailPayload, resolved: EmailCreds, recipients: string[]) {
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
    return { ok: false as const, sandbox: false as const, error: interpretResendError(response.status, body, resolved) }
  }
  return {
    ok: true as const,
    sandbox: false as const,
    id: body.id || '',
    testingMode: isOnboarding(resolved.from),
    provider: 'resend' as const
  }
}

async function sendWithSendgrid(payload: EmailPayload, resolved: EmailCreds, recipients: string[]) {
  const email = fromAddress(resolved.from)
  const name = fromName(resolved.from)
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolved.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map(value => ({ email: value })) }],
      from: name ? { email, name } : { email },
      subject: payload.subject,
      content: [
        {
          type: 'text/plain',
          value: payload.text || payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        },
        { type: 'text/html', value: payload.html }
      ]
    })
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string
      errors?: Array<{ message?: string }>
    }
    return {
      ok: false as const,
      sandbox: false as const,
      error: interpretResendError(response.status, body, resolved)
    }
  }

  const id = response.headers.get('x-message-id') || ''
  return { ok: true as const, sandbox: false as const, id, testingMode: false, provider: 'sendgrid' as const }
}

async function sendWithSmtp(payload: EmailPayload, resolved: EmailCreds, recipients: string[]) {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const pass = String(process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '')
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465

  if (!user || !pass) {
    return { ok: false as const, sandbox: true as const, error: 'SMTP_USER and SMTP_PASS are required for SMTP email.' }
  }

  const transporter = createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  })

  const info = await transporter.sendMail({
    from: resolved.from,
    to: recipients.join(', '),
    subject: payload.subject,
    html: payload.html,
    text: payload.text || payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  })

  return {
    ok: true as const,
    sandbox: false as const,
    id: String(info.messageId || ''),
    testingMode: false,
    provider: 'smtp' as const
  }
}

export async function sendEmail(payload: EmailPayload, creds?: EmailCreds | null) {
  const resolved = creds || resolveEmailCreds()
  if (!emailConfigured(resolved)) {
    return {
      ok: false as const,
      sandbox: true as const,
      error: 'Add Resend, SendGrid, or SMTP credentials plus a From address, then retry.'
    }
  }

  const to = Array.isArray(payload.to) ? payload.to : [payload.to]
  const recipients = to.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
  if (!recipients.length) {
    return { ok: false as const, sandbox: false as const, error: 'A recipient email address is required.' }
  }

  if (resolved.provider === 'resend' && isOnboarding(resolved.from) && recipients.length > 1) {
    return {
      ok: false as const,
      sandbox: false as const,
      error:
        'From uses onboarding@resend.dev (test mode). Resend only allows sending to your own account email until you verify a custom domain.'
    }
  }

  try {
    if (resolved.provider === 'sendgrid') return await sendWithSendgrid(payload, resolved, recipients)
    if (resolved.provider === 'smtp') return await sendWithSmtp(payload, resolved, recipients)
    return await sendWithResend(payload, resolved, recipients)
  } catch (error) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: error instanceof Error ? error.message : 'Email send failed.'
    }
  }
}
