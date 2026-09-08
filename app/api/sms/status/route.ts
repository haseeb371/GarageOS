import { NextResponse } from 'next/server'
import { smsConfigured, smsFromNumber, smsSetupChecklist } from '@/lib/sms'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = smsConfigured()
  const checklist = smsSetupChecklist()

  return NextResponse.json({
    configured,
    provider: 'Twilio',
    from: configured ? smsFromNumber() : '',
    message: configured
      ? `Live SMS ready from ${smsFromNumber()}. Trial accounts can only text verified numbers.`
      : 'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to .env.local, then restart AutoGaragify.',
    checklist: checklist.steps,
    setup: checklist.setup
  })
}
