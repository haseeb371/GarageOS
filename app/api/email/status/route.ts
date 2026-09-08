import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { emailConfigured, emailFrom, emailSetupChecklist } from '@/lib/email'
import { loadProviderCredentials, resolveEmailCreds } from '@/lib/providerCredentials'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shop = await loadProviderCredentials(user.shopId)
  const creds = resolveEmailCreds(shop)
  const configured = emailConfigured(creds)
  const checklist = emailSetupChecklist(creds)

  return NextResponse.json({
    configured,
    provider: 'Resend',
    from: configured ? emailFrom(creds) : '',
    domain: checklist.domain,
    testingMode: checklist.testingMode,
    source: shop.email.apiKey || shop.email.from ? 'shop' : creds.apiKey ? 'env' : 'none',
    message: !configured
      ? 'Paste Resend API key + From in Ops → Support & compliance (or .env.local).'
      : checklist.testingMode
        ? `Test sender active (${emailFrom(creds)}). Can only email your Resend account address until a custom domain is verified.`
        : `Live email ready from ${emailFrom(creds)}.`,
    checklist: checklist.steps,
    setup: checklist.setup
  })
}
