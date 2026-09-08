import type { AccountingCreds } from './providerCredentials'
import { resolveAccountingCreds } from './providerCredentials'

export type JournalLine = {
  date: string
  type: 'Invoice' | 'Payment'
  reference: string
  customer: string
  repairOrder: string
  description: string
  debit: number
  credit: number
  method: string
  status: string
}

type Row = Record<string, unknown> & { id: string }

export type AccountingMode = 'sandbox' | 'webhook' | 'quickbooks' | 'xero'

export function accountingProvider(creds?: AccountingCreds | null): AccountingMode {
  const resolved = creds || resolveAccountingCreds()
  const explicit = String(resolved.provider || '').trim().toLowerCase()
  if (explicit === 'webhook' || explicit === 'sandbox') return explicit
  if (explicit === 'quickbooks' || explicit === 'xero') return explicit
  // Env-only QBO/Xero still win when shop hasn't set a webhook
  if (!resolved.webhookUrl) {
    if (process.env.QUICKBOOKS_ACCESS_TOKEN?.trim() && process.env.QUICKBOOKS_REALM_ID?.trim()) return 'quickbooks'
    if (process.env.XERO_ACCESS_TOKEN?.trim() && process.env.XERO_TENANT_ID?.trim()) return 'xero'
  }
  if (resolved.webhookUrl) return 'webhook'
  if (process.env.QUICKBOOKS_ACCESS_TOKEN?.trim() && process.env.QUICKBOOKS_REALM_ID?.trim()) return 'quickbooks'
  if (process.env.XERO_ACCESS_TOKEN?.trim() && process.env.XERO_TENANT_ID?.trim()) return 'xero'
  return 'sandbox'
}

export function accountingWebhookUrl(creds?: AccountingCreds | null) {
  return (creds || resolveAccountingCreds()).webhookUrl
}

export function describeWebhookUrl(raw?: string) {
  const url = String(raw || accountingWebhookUrl() || '').trim()
  if (!url) {
    return {
      ok: false as const,
      host: '',
      path: '',
      isZapierCatchHook: false,
      error: 'Webhook URL is empty. Paste a Zapier Catch Hook URL in Ops → Accounting & CRM.'
    }
  }
  try {
    const parsed = new URL(url)
    const isZapierCatchHook =
      parsed.hostname.includes('hooks.zapier.com') && parsed.pathname.includes('/hooks/catch/')
    return {
      ok: true as const,
      host: parsed.host,
      path: parsed.pathname,
      isZapierCatchHook,
      error: isZapierCatchHook
        ? ''
        : parsed.hostname.includes('hooks.zapier.com')
          ? 'URL is on hooks.zapier.com but is not a /hooks/catch/… Catch Hook. Recreate the Zap trigger as Catch Hook.'
          : 'URL is not a Zapier Catch Hook (expected hooks.zapier.com/hooks/catch/…). Make/custom webhooks still work if they accept POST JSON.'
    }
  } catch {
    return {
      ok: false as const,
      host: '',
      path: '',
      isZapierCatchHook: false,
      error: 'Webhook URL is not a valid URL.'
    }
  }
}

export function accountingConfigured(creds?: AccountingCreds | null) {
  const mode = accountingProvider(creds)
  if (mode === 'webhook') return Boolean(accountingWebhookUrl(creds))
  if (mode === 'quickbooks') {
    return Boolean(
      process.env.QUICKBOOKS_ACCESS_TOKEN?.trim() &&
        process.env.QUICKBOOKS_REALM_ID?.trim() &&
        process.env.QUICKBOOKS_AR_ACCOUNT_ID?.trim() &&
        process.env.QUICKBOOKS_INCOME_ACCOUNT_ID?.trim() &&
        process.env.QUICKBOOKS_DEPOSIT_ACCOUNT_ID?.trim()
    )
  }
  if (mode === 'xero') {
    return Boolean(process.env.XERO_ACCESS_TOKEN?.trim() && process.env.XERO_TENANT_ID?.trim())
  }
  return false
}

export function accountingSetupChecklist(creds?: AccountingCreds | null) {
  const resolved = creds || resolveAccountingCreds()
  const mode = accountingProvider(resolved)
  const webhook = describeWebhookUrl(resolved.webhookUrl)
  const steps: Array<{ id: string; label: string; done: boolean; detail: string }> = []

  if (mode === 'webhook' || mode === 'sandbox') {
    steps.push({
      id: 'provider',
      label: 'Accounting mode = webhook',
      done: mode === 'webhook' || Boolean(resolved.webhookUrl),
      detail: 'Set provider to webhook in Ops (or ACCOUNTING_PROVIDER="webhook").'
    })
    steps.push({
      id: 'url',
      label: 'Paste Catch Hook URL',
      done: webhook.ok && Boolean(resolved.webhookUrl),
      detail: webhook.error || `Host: ${webhook.host}`
    })
    steps.push({
      id: 'zapier-shape',
      label: 'URL looks like Zapier Catch Hook',
      done: webhook.isZapierCatchHook,
      detail: webhook.isZapierCatchHook
        ? `${webhook.host}${webhook.path}`
        : webhook.error || 'Optional for Make/custom; required shape for Zapier.'
    })
    steps.push({
      id: 'publish',
      label: 'Publish the Zap after Test trigger',
      done: false,
      detail: 'In Zapier: Catch Hook → Test trigger → add Action (optional) → Publish. Unpublished/deleted hooks return 404 “please unsubscribe me!”.'
    })
  }

  if (mode === 'quickbooks') {
    const fields = [
      ['QUICKBOOKS_ACCESS_TOKEN', process.env.QUICKBOOKS_ACCESS_TOKEN],
      ['QUICKBOOKS_REALM_ID', process.env.QUICKBOOKS_REALM_ID],
      ['QUICKBOOKS_AR_ACCOUNT_ID', process.env.QUICKBOOKS_AR_ACCOUNT_ID],
      ['QUICKBOOKS_INCOME_ACCOUNT_ID', process.env.QUICKBOOKS_INCOME_ACCOUNT_ID],
      ['QUICKBOOKS_DEPOSIT_ACCOUNT_ID', process.env.QUICKBOOKS_DEPOSIT_ACCOUNT_ID]
    ] as const
    for (const [name, value] of fields) {
      steps.push({
        id: name,
        label: name,
        done: Boolean(String(value || '').trim()),
        detail: String(value || '').trim() ? 'Set' : 'Missing in .env.local'
      })
    }
  }

  if (mode === 'xero') {
    for (const [name, value] of [
      ['XERO_ACCESS_TOKEN', process.env.XERO_ACCESS_TOKEN],
      ['XERO_TENANT_ID', process.env.XERO_TENANT_ID]
    ] as const) {
      steps.push({
        id: name,
        label: name,
        done: Boolean(String(value || '').trim()),
        detail: String(value || '').trim() ? 'Set' : 'Missing in .env.local'
      })
    }
  }

  return { mode, configured: accountingConfigured(resolved), steps, webhook }
}

function interpretWebhookFailure(status: number, text: string, url: string) {
  const body = String(text || '').trim()
  const lower = body.toLowerCase()
  const meta = describeWebhookUrl(url)

  if (status === 404 || lower.includes('unsubscribe')) {
    return [
      `Webhook rejected the request (HTTP ${status}).`,
      body ? `Provider said: “${body.slice(0, 120)}”.` : '',
      'This usually means the Catch Hook was deleted, never published, or the URL was copied wrong.',
      'Fix: Zapier → Trigger → Webhooks → Catch Hook → copy a fresh Custom webhook URL → paste in Ops → Accounting & CRM → Publish the Zap.'
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (!meta.isZapierCatchHook && meta.ok) {
    return `HTTP ${status} from ${meta.host}. ${body.slice(0, 120) || 'No body.'} Confirm the endpoint accepts POST JSON.`
  }

  return `Zapier/webhook returned HTTP ${status}${body ? `: ${body.slice(0, 160)}` : '.'}`
}

export function buildAccountingJournal(
  invoices: Row[],
  payments: Row[],
  customers: Row[],
  options: { from?: string; to?: string } = {}
) {
  const from = options.from || ''
  const to = options.to || ''
  const inRange = (value: string) => (!from || value >= from) && (!to || value <= to)
  const customerName = (id: string) => String(customers.find(row => row.id === id)?.name || id || '')

  const lines: JournalLine[] = []

  for (const invoice of invoices) {
    const date = String(invoice.issuedAt || invoice.date || invoice.due || '').slice(0, 10)
    if (!inRange(date)) continue
    const total = Number(invoice.total || 0)
    lines.push({
      date,
      type: 'Invoice',
      reference: String(invoice.id),
      customer: customerName(String(invoice.customerId || '')),
      repairOrder: String(invoice.orderId || ''),
      description: `Invoice ${invoice.id}`,
      debit: total,
      credit: 0,
      method: '',
      status: String(invoice.status || '')
    })
  }

  for (const payment of payments) {
    const date = String(payment.date || '').slice(0, 10)
    if (!inRange(date)) continue
    const amount = Number(payment.amount || 0)
    lines.push({
      date,
      type: 'Payment',
      reference: String(payment.id),
      customer: '',
      repairOrder: String(payment.invoiceId || ''),
      description: `Payment for ${payment.invoiceId || payment.id}`,
      debit: 0,
      credit: amount,
      method: String(payment.method || ''),
      status: String(payment.status || '')
    })
  }

  lines.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference))
  return lines
}

export async function pushAccountingJournal(
  input: {
    shopId: string
    shopName: string
    from: string
    to: string
    lines: JournalLine[]
  },
  creds?: AccountingCreds | null
) {
  const resolved = creds || resolveAccountingCreds()
  const mode = accountingProvider(resolved)

  if (mode === 'sandbox' || !accountingConfigured(resolved)) {
    return {
      ok: true as const,
      sandbox: true as const,
      mode: 'sandbox' as const,
      recordsProcessed: input.lines.length,
      externalId: '',
      message: 'Sandbox sync complete. No external accounting system was contacted. Download the accounting journal CSV or connect a provider.'
    }
  }

  if (mode === 'webhook') {
    return pushWebhook(input, resolved)
  }
  if (mode === 'quickbooks') {
    return pushQuickBooks(input)
  }
  return pushXero(input)
}

async function pushWebhook(
  input: {
    shopId: string
    shopName: string
    from: string
    to: string
    lines: JournalLine[]
  },
  creds?: AccountingCreds | null
) {
  const resolved = creds || resolveAccountingCreds()
  const url = resolved.webhookUrl
  if (!url) {
    return {
      ok: false as const,
      sandbox: false as const,
      mode: 'webhook' as const,
      recordsProcessed: 0,
      externalId: '',
      error: 'Accounting webhook URL is empty.'
    }
  }

  const shape = describeWebhookUrl(url)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(resolved.webhookSecret ? { Authorization: `Bearer ${resolved.webhookSecret}` } : {})
      },
      body: JSON.stringify({
        source: 'AutoGaragify',
        shopId: input.shopId,
        shopName: input.shopName,
        from: input.from || null,
        to: input.to || null,
        generatedAt: new Date().toISOString(),
        lines: input.lines,
        totals: {
          invoiceDebits: input.lines.filter(line => line.type === 'Invoice').reduce((sum, line) => sum + line.debit, 0),
          paymentCredits: input.lines.filter(line => line.type === 'Payment').reduce((sum, line) => sum + line.credit, 0)
        }
      })
    })
  } catch (error) {
    return {
      ok: false as const,
      sandbox: false as const,
      mode: 'webhook' as const,
      recordsProcessed: 0,
      externalId: '',
      error: `Could not reach accounting webhook (${shape.host || 'invalid URL'}): ${error instanceof Error ? error.message : 'network error'}`
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false as const,
      sandbox: false as const,
      mode: 'webhook' as const,
      recordsProcessed: 0,
      externalId: '',
      error: interpretWebhookFailure(response.status, text, url)
    }
  }

  return {
    ok: true as const,
    sandbox: false as const,
    mode: 'webhook' as const,
    recordsProcessed: input.lines.length,
    externalId: '',
    message:
      input.lines.length === 0
        ? `Webhook accepted the request, but there were 0 journal lines in this date range. Widen the period or add invoices/payments.`
        : `Posted ${input.lines.length} journal line(s) to ${shape.isZapierCatchHook ? 'Zapier' : shape.host || 'the accounting webhook'}.`
  }
}

async function pushQuickBooks(input: {
  shopName: string
  from: string
  to: string
  lines: JournalLine[]
}) {
  const realmId = String(process.env.QUICKBOOKS_REALM_ID || '').trim()
  const token = String(process.env.QUICKBOOKS_ACCESS_TOKEN || '').trim()
  const arAccount = String(process.env.QUICKBOOKS_AR_ACCOUNT_ID || '').trim()
  const incomeAccount = String(process.env.QUICKBOOKS_INCOME_ACCOUNT_ID || '').trim()
  const depositAccount = String(process.env.QUICKBOOKS_DEPOSIT_ACCOUNT_ID || '').trim()
  const minor = process.env.QUICKBOOKS_MINOR_VERSION?.trim() || '65'
  const base = process.env.QUICKBOOKS_API_BASE?.trim() || 'https://sandbox-quickbooks.api.intuit.com'

  const qboLines: Array<Record<string, unknown>> = []
  let lineId = 0

  for (const line of input.lines) {
    if (line.type === 'Invoice' && line.debit > 0) {
      qboLines.push(
        qbLine(++lineId, line.debit, 'Debit', arAccount, `${line.description} · ${line.customer}`),
        qbLine(++lineId, line.debit, 'Credit', incomeAccount, `${line.description} · income`)
      )
    }
    if (line.type === 'Payment' && line.credit > 0) {
      qboLines.push(
        qbLine(++lineId, line.credit, 'Debit', depositAccount, `${line.description} · ${line.method || 'payment'}`),
        qbLine(++lineId, line.credit, 'Credit', arAccount, `${line.description} · A/R`)
      )
    }
  }

  if (!qboLines.length) {
    return {
      ok: true as const,
      sandbox: false as const,
      mode: 'quickbooks' as const,
      recordsProcessed: 0,
      externalId: '',
      message: 'No invoice or payment lines in range to sync.'
    }
  }

  const response = await fetch(`${base}/v3/company/${encodeURIComponent(realmId)}/journalentry?minorversion=${minor}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      DocNumber: `GO-${Date.now().toString().slice(-8)}`,
      PrivateNote: `AutoGaragify sync · ${input.shopName} · ${input.from || 'all'} to ${input.to || 'all'}`,
      Line: qboLines
    })
  })

  const body = (await response.json().catch(() => ({}))) as {
    JournalEntry?: { Id?: string }
    Fault?: { Error?: Array<{ Message?: string; Detail?: string }> }
  }

  if (!response.ok) {
    const fault = body.Fault?.Error?.[0]
    return {
      ok: false as const,
      sandbox: false as const,
      mode: 'quickbooks' as const,
      recordsProcessed: 0,
      externalId: '',
      error: fault?.Detail || fault?.Message || `QuickBooks returned ${response.status}.`
    }
  }

  return {
    ok: true as const,
    sandbox: false as const,
    mode: 'quickbooks' as const,
    recordsProcessed: input.lines.length,
    externalId: body.JournalEntry?.Id || '',
    message: `Synced ${input.lines.length} line(s) to QuickBooks as journal entry ${body.JournalEntry?.Id || ''}.`
  }
}

function qbLine(id: number, amount: number, postingType: 'Debit' | 'Credit', accountId: string, description: string) {
  return {
    Id: String(id),
    Description: description.slice(0, 4000),
    Amount: Number(amount.toFixed(2)),
    DetailType: 'JournalEntryLineDetail',
    JournalEntryLineDetail: {
      PostingType: postingType,
      AccountRef: { value: accountId }
    }
  }
}

async function pushXero(input: {
  shopName: string
  from: string
  to: string
  lines: JournalLine[]
}) {
  const token = String(process.env.XERO_ACCESS_TOKEN || '').trim()
  const tenantId = String(process.env.XERO_TENANT_ID || '').trim()
  const journalLines: Array<Record<string, unknown>> = []

  for (const line of input.lines) {
    if (line.type === 'Invoice' && line.debit > 0) {
      journalLines.push(
        { Description: `${line.description} · ${line.customer}`, LineAmount: Number(line.debit.toFixed(2)), AccountCode: process.env.XERO_AR_ACCOUNT_CODE || '610' },
        { Description: `${line.description} · income`, LineAmount: -Number(line.debit.toFixed(2)), AccountCode: process.env.XERO_INCOME_ACCOUNT_CODE || '200' }
      )
    }
    if (line.type === 'Payment' && line.credit > 0) {
      journalLines.push(
        { Description: `${line.description} · ${line.method || 'payment'}`, LineAmount: Number(line.credit.toFixed(2)), AccountCode: process.env.XERO_DEPOSIT_ACCOUNT_CODE || '090' },
        { Description: `${line.description} · A/R`, LineAmount: -Number(line.credit.toFixed(2)), AccountCode: process.env.XERO_AR_ACCOUNT_CODE || '610' }
      )
    }
  }

  if (!journalLines.length) {
    return {
      ok: true as const,
      sandbox: false as const,
      mode: 'xero' as const,
      recordsProcessed: 0,
      externalId: '',
      message: 'No invoice or payment lines in range to sync.'
    }
  }

  const response = await fetch('https://api.xero.com/api.xro/2.0/ManualJournals', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ManualJournals: [
        {
          Narration: `AutoGaragify sync · ${input.shopName} · ${input.from || 'all'} to ${input.to || 'all'}`,
          Date: (input.to || new Date().toISOString().slice(0, 10)),
          Status: 'POSTED',
          JournalLines: journalLines
        }
      ]
    })
  })

  const body = (await response.json().catch(() => ({}))) as {
    ManualJournals?: Array<{ ManualJournalID?: string }>
    Message?: string
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>
  }

  if (!response.ok) {
    const validation = body.Elements?.[0]?.ValidationErrors?.[0]?.Message
    return {
      ok: false as const,
      sandbox: false as const,
      mode: 'xero' as const,
      recordsProcessed: 0,
      externalId: '',
      error: validation || body.Message || `Xero returned ${response.status}.`
    }
  }

  const externalId = body.ManualJournals?.[0]?.ManualJournalID || ''
  return {
    ok: true as const,
    sandbox: false as const,
    mode: 'xero' as const,
    recordsProcessed: input.lines.length,
    externalId,
    message: `Synced ${input.lines.length} line(s) to Xero as manual journal ${externalId}.`
  }
}
