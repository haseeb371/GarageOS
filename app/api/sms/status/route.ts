import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { smsConfigured, smsFromNumber, smsSetupChecklist } from '@/lib/sms'
import { loadProviderCredentials, resolveSmsCreds } from '@/lib/providerCredentials'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shop = await loadProviderCredentials(user.shopId)
  const creds = resolveSmsCreds(shop)
  const configured = smsConfigured(creds)
  const checklist = smsSetupChecklist(creds)

  return NextResponse.json({
    configured,
    provider: 'Twilio',
    from: configured ? smsFromNumber(creds) : '',
    source: shop.sms.accountSid || shop.sms.authToken || shop.sms.from ? 'shop' : creds.accountSid ? 'env' : 'none',
    message: configured
      ? `Live SMS ready from ${smsFromNumber(creds)}. Trial accounts can only text verified numbers.`
      : 'Paste Twilio Account SID, Auth Token, and phone in Ops → Support & compliance (or .env.local).',
    checklist: checklist.steps,
    setup: checklist.setup
  })
}
