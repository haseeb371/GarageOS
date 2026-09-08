import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

export type EmailCreds = { apiKey: string; from: string }
export type SmsCreds = { accountSid: string; authToken: string; from: string }
export type AccountingCreds = {
  provider: 'webhook' | 'sandbox' | ''
  webhookUrl: string
  webhookSecret: string
}

export type ProviderCredentials = {
  id: string
  email: EmailCreds
  sms: SmsCreds
  accounting: AccountingCreds
  updatedAt: string
}

type Row = Record<string, unknown> & { id: string }

function clean(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
}

export function providerCredentialsId(shopId: string) {
  return `PC-${String(shopId).slice(0, 12)}`
}

export function emptyProviderCredentials(shopId: string): ProviderCredentials {
  return {
    id: providerCredentialsId(shopId),
    email: { apiKey: '', from: '' },
    sms: { accountSid: '', authToken: '', from: '' },
    accounting: { provider: '', webhookUrl: '', webhookSecret: '' },
    updatedAt: ''
  }
}

export function parseProviderCredentials(data: Row | null | undefined, shopId: string): ProviderCredentials {
  const base = emptyProviderCredentials(shopId)
  if (!data) return base
  const email = (data.email || {}) as Record<string, unknown>
  const sms = (data.sms || {}) as Record<string, unknown>
  const accounting = (data.accounting || {}) as Record<string, unknown>
  return {
    id: String(data.id || base.id),
    email: {
      apiKey: decryptSecret(clean(email.apiKey)),
      from: clean(email.from)
    },
    sms: {
      accountSid: clean(sms.accountSid),
      authToken: decryptSecret(clean(sms.authToken)),
      from: clean(sms.from)
    },
    accounting: {
      provider: (clean(accounting.provider).toLowerCase() as AccountingCreds['provider']) || '',
      webhookUrl: clean(accounting.webhookUrl),
      webhookSecret: decryptSecret(clean(accounting.webhookSecret))
    },
    updatedAt: clean(data.updatedAt)
  }
}

/** Shop-saved values win; otherwise fall back to server .env.local. */
export function resolveEmailCreds(shop?: ProviderCredentials | null): EmailCreds {
  return {
    apiKey: clean(shop?.email.apiKey) || clean(process.env.RESEND_API_KEY),
    from: clean(shop?.email.from) || clean(process.env.EMAIL_FROM)
  }
}

export function resolveSmsCreds(shop?: ProviderCredentials | null): SmsCreds {
  return {
    accountSid: clean(shop?.sms.accountSid) || clean(process.env.TWILIO_ACCOUNT_SID),
    authToken: clean(shop?.sms.authToken) || clean(process.env.TWILIO_AUTH_TOKEN),
    from: clean(shop?.sms.from) || clean(process.env.TWILIO_PHONE_NUMBER)
  }
}

export function resolveAccountingCreds(shop?: ProviderCredentials | null): AccountingCreds {
  const webhookUrl = clean(shop?.accounting.webhookUrl) || clean(process.env.ACCOUNTING_WEBHOOK_URL)
  const providerRaw =
    clean(shop?.accounting.provider) ||
    clean(process.env.ACCOUNTING_PROVIDER) ||
    (webhookUrl ? 'webhook' : '')
  return {
    provider: (providerRaw.toLowerCase() as AccountingCreds['provider']) || '',
    webhookUrl,
    webhookSecret: clean(shop?.accounting.webhookSecret) || clean(process.env.ACCOUNTING_WEBHOOK_SECRET)
  }
}

export async function loadProviderCredentials(shopId: string): Promise<ProviderCredentials> {
  const id = providerCredentialsId(shopId)
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.shopId, shopId), eq(records.id, id)))
  if (!rows[0]) return emptyProviderCredentials(shopId)
  return parseProviderCredentials(JSON.parse(rows[0].data) as Row, shopId)
}

export function publicCredentialStatus(shop: ProviderCredentials) {
  const email = resolveEmailCreds(shop)
  const sms = resolveSmsCreds(shop)
  const accounting = resolveAccountingCreds(shop)
  return {
    email: {
      configured: Boolean(email.apiKey && email.from),
      from: email.from,
      source: shop.email.apiKey || shop.email.from ? 'shop' : email.apiKey ? 'env' : 'none',
      hasApiKey: Boolean(email.apiKey)
    },
    sms: {
      configured: Boolean(sms.accountSid && sms.authToken && sms.from),
      from: sms.from,
      source: shop.sms.accountSid || shop.sms.authToken || shop.sms.from ? 'shop' : sms.accountSid ? 'env' : 'none',
      hasToken: Boolean(sms.authToken)
    },
    accounting: {
      configured: Boolean(accounting.webhookUrl),
      provider: accounting.provider || (accounting.webhookUrl ? 'webhook' : 'sandbox'),
      webhookUrl: accounting.webhookUrl,
      source: shop.accounting.webhookUrl ? 'shop' : accounting.webhookUrl ? 'env' : 'none'
    },
    updatedAt: shop.updatedAt
  }
}

export async function saveProviderCredentials(
  shopId: string,
  patch: Partial<{
    email: Partial<EmailCreds>
    sms: Partial<SmsCreds>
    accounting: Partial<AccountingCreds>
  }>
) {
  const current = await loadProviderCredentials(shopId)
  const next: ProviderCredentials = {
    id: current.id,
    email: {
      apiKey: patch.email?.apiKey !== undefined ? clean(patch.email.apiKey) : current.email.apiKey,
      from: patch.email?.from !== undefined ? clean(patch.email.from) : current.email.from
    },
    sms: {
      accountSid: patch.sms?.accountSid !== undefined ? clean(patch.sms.accountSid) : current.sms.accountSid,
      authToken: patch.sms?.authToken !== undefined ? clean(patch.sms.authToken) : current.sms.authToken,
      from: patch.sms?.from !== undefined ? clean(patch.sms.from) : current.sms.from
    },
    accounting: {
      provider:
        patch.accounting?.provider !== undefined
          ? ((clean(patch.accounting.provider).toLowerCase() as AccountingCreds['provider']) || '')
          : current.accounting.provider,
      webhookUrl:
        patch.accounting?.webhookUrl !== undefined
          ? clean(patch.accounting.webhookUrl)
          : current.accounting.webhookUrl,
      webhookSecret:
        patch.accounting?.webhookSecret !== undefined
          ? clean(patch.accounting.webhookSecret)
          : current.accounting.webhookSecret
    },
    updatedAt: new Date().toISOString()
  }

  const now = Date.now()
  const data = {
    ...next,
    shopId,
    email: { ...next.email, apiKey: encryptSecret(next.email.apiKey) },
    sms: { ...next.sms, authToken: encryptSecret(next.sms.authToken) },
    accounting: { ...next.accounting, webhookSecret: encryptSecret(next.accounting.webhookSecret) }
  }
  await db
    .insert(records)
    .values({
      id: next.id,
      kind: 'providerCredentials',
      shopId,
      data: JSON.stringify(data),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: records.id,
      set: { data: JSON.stringify(data), kind: 'providerCredentials', shopId, updatedAt: now }
    })

  return next
}
