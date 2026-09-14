import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema } from '@/lib/db'
import { bookDemoAppointment, listDemoSlots } from '@/lib/salesCalendar'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureSchema()
  const shopId = getConfig().LEADS_IMPORT_SHOP_ID
  if (!shopId) {
    return NextResponse.json({ error: 'Sales calendar shop is not configured.' }, { status: 503 })
  }
  const slots = await listDemoSlots({ shopId, limit: 12 })
  return NextResponse.json({
    timezone: process.env.SALES_TZ || 'America/Chicago',
    slots: slots.map(s => ({
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      label: s.label,
      iso: new Date(s.startsAt).toISOString()
    }))
  })
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const shopId = getConfig().LEADS_IMPORT_SHOP_ID
  if (!shopId) {
    return NextResponse.json({ error: 'Sales calendar shop is not configured.' }, { status: 503 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const startsAt = Number(body.startsAt || Date.parse(String(body.iso || body.datetime_iso || '')))
  const booked = await bookDemoAppointment({
    shopId,
    businessName: String(body.businessName || body.business_name || ''),
    contactName: String(body.contactName || body.contact_name || ''),
    phone: String(body.phone || ''),
    email: String(body.email || ''),
    startsAt,
    source: 'web',
    notes: String(body.notes || '')
  })

  if (!booked.ok) {
    return NextResponse.json({ error: booked.error }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    id: booked.id,
    label: booked.label,
    startsAt: booked.startsAt,
    message: booked.message
  })
}
