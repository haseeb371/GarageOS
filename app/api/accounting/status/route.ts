import { NextResponse } from 'next/server'
import {
  accountingConfigured,
  accountingProvider,
  accountingSetupChecklist,
  describeWebhookUrl
} from '@/lib/accounting'

export const dynamic = 'force-dynamic'

export async function GET() {
  const mode = accountingProvider()
  const configured = accountingConfigured()
  const checklist = accountingSetupChecklist()
  const webhook = describeWebhookUrl()

  const messages: Record<string, string> = {
    sandbox:
      'Sandbox mode: Sync accounting records history locally and you can still download the journal CSV. To go live, set a Zapier Catch Hook or QuickBooks/Xero tokens.',
    webhook: configured
      ? webhook.isZapierCatchHook
        ? `Zapier Catch Hook connected (${webhook.host}). Sync posts invoice/payment journal JSON. If you see 404 “unsubscribe”, recreate and publish the hook.`
        : `Webhook connected (${webhook.host}). Sync posts invoice/payment journal JSON.`
      : webhook.error || 'Set ACCOUNTING_WEBHOOK_URL in .env.local, then restart AutoGragify.',
    quickbooks: configured
      ? 'QuickBooks Online credentials are present. Sync creates a journal entry for invoices and payments.'
      : 'Add QUICKBOOKS_ACCESS_TOKEN, QUICKBOOKS_REALM_ID, and AR/income/deposit account IDs, then restart.',
    xero: configured
      ? 'Xero credentials are present. Sync creates a manual journal for invoices and payments.'
      : 'Add XERO_ACCESS_TOKEN and XERO_TENANT_ID (plus optional account codes), then restart.'
  }

  return NextResponse.json({
    configured,
    mode,
    message: messages[mode] || messages.sandbox,
    csvExport: '/api/export/accounting',
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
        'Copy Custom webhook URL into .env.local as ACCOUNTING_WEBHOOK_URL',
        'Set ACCOUNTING_PROVIDER="webhook"',
        'Restart AutoGragify',
        'Reports → Sync accounting (or Operations → Sync this month)',
        'In Zapier: Test trigger → Publish'
      ],
      quickbooks: [
        'Create Intuit app / sandbox company',
        'Set QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_REALM_ID',
        'Set AR, income, and deposit account IDs',
        'Set ACCOUNTING_PROVIDER="quickbooks"',
        'Restart and Sync accounting'
      ]
    }
  })
}
