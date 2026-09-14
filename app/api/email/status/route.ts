import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { emailConfigured, emailFrom, emailProviderLabel, emailSetupChecklist } from '@/lib/email'
import { loadProviderCredentials, resolveEmailCreds } from '@/lib/providerCredentials'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shop = await loadProviderCredentials(user.shopId)
  const creds = resolveEmailCreds(shop)
  const configured = emailConfigured(creds)
  const checklist = emailSetupChecklist(creds)
  const provider = emailProviderLabel(creds)

  return NextResponse.json({
    configured,
    provider,
    from: configured ? emailFrom(creds) : '',
    domain: checklist.domain,
    testingMode: checklist.testingMode,
    source:
      shop.email.apiKey || shop.email.from
        ? 'shop'
        : creds.apiKey || creds.provider === 'smtp'
          ? 'env'
          : 'none',
    message: !configured
      ? 'Add SendGrid, Resend, or SMTP credentials (plus From address) in Vercel env or Ops.'
      : checklist.testingMode
        ? `Test sender active (${emailFrom(creds)}).`
        : `Live email ready via ${provider} from ${emailFrom(creds)}.`,
    checklist: checklist.steps,
    setup: checklist.setup
  })
}
