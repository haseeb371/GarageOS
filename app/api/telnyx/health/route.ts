import { NextResponse } from 'next/server'
import { getConfig, isDialerEnabled, isDryRun } from '@/lib/config'
import { assistantConfigured, telnyxConfigured } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'

export async function GET() {
  const c = getConfig()
  return NextResponse.json({
    ok: true,
    telnyxConfigured: telnyxConfigured(),
    assistantConfigured: assistantConfigured(),
    dialerEnabled: isDialerEnabled(),
    dryRun: isDryRun(),
    promptVersion: c.AI_PROMPT_VERSION,
    fromNumber: c.TELNYX_FROM_NUMBER || null
  })
}
