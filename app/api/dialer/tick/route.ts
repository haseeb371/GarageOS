import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema } from '@/lib/db'
import { runDialerTick } from '@/lib/dialer'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  const header = req.headers.get('authorization') || ''
  if (header === `Bearer ${secret}`) return true
  const q = req.nextUrl.searchParams.get('secret')
  return q === secret
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const shopId =
    req.nextUrl.searchParams.get('shopId') ||
    process.env.LEADS_IMPORT_SHOP_ID?.trim() ||
    process.env.TELNYX_SHOP_ID?.trim() ||
    ''
  if (!shopId) {
    return NextResponse.json(
      { error: 'shopId query param or LEADS_IMPORT_SHOP_ID env is required.' },
      { status: 400 }
    )
  }
  const result = await runDialerTick(shopId)
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  return POST(req)
}
