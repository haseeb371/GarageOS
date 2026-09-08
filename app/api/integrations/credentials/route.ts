import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import {
  loadProviderCredentials,
  publicCredentialStatus,
  resolveAccountingCreds,
  resolveEmailCreds,
  resolveSmsCreds,
  saveProviderCredentials
} from '@/lib/providerCredentials'
import { describeWebhookUrl, pushAccountingJournal } from '@/lib/accounting'
import { sendEmail } from '@/lib/email'
import { sendSms } from '@/lib/sms'

const saveSchema = z.object({
  email: z
    .object({
      apiKey: z.string().optional(),
      from: z.string().optional()
    })
    .optional(),
  sms: z
    .object({
      accountSid: z.string().optional(),
      authToken: z.string().optional(),
      from: z.string().optional()
    })
    .optional(),
  accounting: z
    .object({
      provider: z.string().optional(),
      webhookUrl: z.string().optional(),
      webhookSecret: z.string().optional()
    })
    .optional(),
  test: z.enum(['email', 'sms', 'accounting', 'none']).optional().default('none'),
  testTo: z.string().optional()
})

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner or Manager can view connection settings.' }, { status: 403 })
  }

  const shop = await loadProviderCredentials(user.shopId)
  const status = publicCredentialStatus(shop)
  const accounting = resolveAccountingCreds(shop)
  const webhook = describeWebhookUrl(accounting.webhookUrl)

  return NextResponse.json({
    ok: true,
    status,
    forms: {
      email: {
        apiKeySet: Boolean(shop.email.apiKey),
        from: shop.email.from || status.email.from || ''
      },
      sms: {
        accountSid: shop.sms.accountSid,
        authTokenSet: Boolean(shop.sms.authToken),
        from: shop.sms.from || status.sms.from || ''
      },
      accounting: {
        provider: shop.accounting.provider || accounting.provider || 'webhook',
        webhookUrl: shop.accounting.webhookUrl || accounting.webhookUrl || '',
        webhookSecretSet: Boolean(shop.accounting.webhookSecret),
        webhook
      }
    },
    setup: {
      accounting: [
        'Zapier → Create Zap → Trigger: Webhooks by Zapier → Catch Hook',
        'Copy the Custom webhook URL',
        'Paste below → Save → Publish the Zap',
        'Use Ping webhook or Sync this month to verify'
      ],
      email: [
        'Resend → API Keys → create key',
        'For tests: From = AutoGaragify <onboarding@resend.dev> (only your Resend login email)',
        'For customers: Domains → Add domain → DNS SPF/DKIM → Verified → From = Shop <you@yourdomain.com>'
      ],
      sms: [
        'Twilio Console → Account SID + Auth Token',
        'Phone Numbers → buy/get number in E.164 (+1…)',
        'Trial: verify destination numbers under Verified Caller IDs'
      ]
    }
  })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner or Manager can save connection settings.' }, { status: 403 })
  }

  const parsed = saveSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid credentials payload.' }, { status: 400 })
  }

  const saved = await saveProviderCredentials(user.shopId, {
    email: parsed.data.email,
    sms: parsed.data.sms,
    accounting: parsed.data.accounting
      ? {
          ...parsed.data.accounting,
          provider: parsed.data.accounting.provider as '' | 'webhook' | 'sandbox' | undefined
        }
      : undefined
  })

  let testResult: { ok: boolean; message: string } | null = null
  const test = parsed.data.test || 'none'

  if (test === 'email') {
    const to = String(parsed.data.testTo || '').trim()
    if (!to) return NextResponse.json({ error: 'Enter a test email address.' }, { status: 400 })
    const emailCreds = resolveEmailCreds(saved)
    const result = await sendEmail(
      {
        to,
        subject: 'AutoGaragify email connection test',
        html: `<p>AutoGaragify email is connected for <b>${user.shopId}</b>.</p><p>From: ${emailCreds.from}</p>`
      },
      emailCreds
    )
    testResult = {
      ok: result.ok,
      message: result.ok
        ? `Test email sent to ${to}${result.testingMode ? ' (Resend test mode).' : '.'}`
        : result.error
    }
  }

  if (test === 'sms') {
    const to = String(parsed.data.testTo || '').trim()
    if (!to) return NextResponse.json({ error: 'Enter a test phone number (E.164).' }, { status: 400 })
    const smsCreds = resolveSmsCreds(saved)
    const result = await sendSms({ to, body: 'AutoGaragify SMS connection test. Your Twilio credentials work.' }, smsCreds)
    testResult = {
      ok: result.ok,
      message: result.ok ? `Test SMS sent to ${result.to}.` : result.error
    }
  }

  if (test === 'accounting') {
    const accountingCreds = resolveAccountingCreds(saved)
    const result = await pushAccountingJournal(
      {
        shopId: user.shopId,
        shopName: 'AutoGaragify connection test',
        from: new Date().toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
        lines: [
          {
            date: new Date().toISOString().slice(0, 10),
            type: 'Invoice',
            reference: 'TEST-PING',
            customer: 'Connection test',
            repairOrder: '',
            description: 'AutoGaragify Zapier/webhook ping',
            debit: 1,
            credit: 0,
            method: '',
            status: 'Test'
          }
        ]
      },
      accountingCreds
    )
    testResult = {
      ok: result.ok,
      message: result.ok ? result.message || 'Webhook accepted the ping.' : result.error || 'Webhook ping failed.'
    }
  }

  if (testResult && !testResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        saved: true,
        error: testResult.message,
        status: publicCredentialStatus(saved)
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    saved: true,
    message: testResult?.message || 'Connection settings saved.',
    status: publicCredentialStatus(saved)
  })
}
