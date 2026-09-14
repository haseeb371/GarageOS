import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import {
  accountingConfigured,
  accountingProvider,
  accountingSetupChecklist,
  describeWebhookUrl
} from '@/lib/accounting'
import { loadProviderCredentials, publicCredentialStatus, resolveAccountingCreds } from '@/lib/providerCredentials'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shop = await loadProviderCredentials(user.shopId)
  const creds = resolveAccountingCreds(shop)
  const mode = accountingProvider(creds)
  const configured = accountingConfigured(creds)
  const checklist = accountingSetupChecklist(creds)
  const webhook = describeWebhookUrl(creds.webhookUrl)
  const status = publicCredentialStatus(shop)

  const messages: Record<string, string> = {
    sandbox:
      'Sandbox mode: Sync accounting records history locally and you can still download the journal CSV. To go live, paste a Zapier Catch Hook in Ops → Accounting & CRM.',
    webhook: configured
      ? webhook.isZapierCatchHook
        ? `Zapier Catch Hook connected (${webhook.host}). Sync posts journal lines plus invoice/payment entity arrays for Zapier actions.`
        : `Webhook connected (${webhook.host}). Sync posts journal lines plus invoice/payment entity arrays.`
      : webhook.error || 'Paste ACCOUNTING webhook URL in Ops → Accounting & CRM.',
    quickbooks: configured
      ? 'QuickBooks Online credentials are present. Sync creates a journal entry covering invoices and payments in range.'
      : 'Add QUICKBOOKS_ACCESS_TOKEN, QUICKBOOKS_REALM_ID, and AR/income/deposit account IDs, then restart.',
    xero: configured
      ? 'Xero credentials are present. Sync creates a manual journal covering invoices and payments in range.'
      : 'Add XERO_ACCESS_TOKEN and XERO_TENANT_ID (plus optional account codes), then restart.'
  }

  return NextResponse.json({
    configured,
    mode,
    source: status.accounting.source,
    message: messages[mode] || messages.sandbox,
    csvExport: '/api/export/accounting',
    includeEntities: String(process.env.ACCOUNTING_INCLUDE_ENTITIES || 'true').toLowerCase() !== 'false',
    webhook: {
      host: webhook.host,
      path: webhook.path,
      isZapierCatchHook: webhook.isZapierCatchHook,
      error: webhook.error
    },
    checklist: checklist.steps,
    setup: {
      zapier: [
        'Create Zap → Trigger: Webhooks by Zapier → Catch Hook',
        'Copy Custom webhook URL',
        'Paste in Ops → Accounting & CRM → Save (or set ACCOUNTING_WEBHOOK_URL)',
        'Reports → Sync accounting (or Operations → Sync this month)',
        'Map invoice/payment fields from the entities arrays in Zapier',
        'In Zapier: Test trigger → Publish'
      ],
      quickbooks: [
        'Create Intuit app / sandbox company',
        'Set QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_REALM_ID in .env.local',
        'Set AR, income, and deposit account IDs',
        'Set ACCOUNTING_PROVIDER="quickbooks"',
        'Restart and Sync accounting'
      ],
      xero: [
        'Create Xero app and get access token + tenant id',
        'Set XERO_ACCESS_TOKEN and XERO_TENANT_ID',
        'Optional: XERO_AR_ACCOUNT_CODE / INCOME / DEPOSIT codes',
        'Set ACCOUNTING_PROVIDER="xero"',
        'Restart and Sync accounting'
      ]
    }
  })
}
