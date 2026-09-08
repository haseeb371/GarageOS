import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { generateTimeSlots, validateBookingTime } from '@/lib/booking'

const query = z.object({
  shopId: z.string().min(1),
  date: z.string().date()
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = query.safeParse({ shopId: url.searchParams.get('shopId'), date: url.searchParams.get('date') })
  if (!parsed.success) return NextResponse.json({ error: 'Provide shopId and date (YYYY-MM-DD).' }, { status: 400 })
  const { shopId, date } = parsed.data
  const shopRows = await db.select().from(records).where(and(eq(records.id, shopId), eq(records.kind, 'shops')))
  if (!shopRows.length) return NextResponse.json({ error: 'Booking page not found.' }, { status: 404 })
  const tenantId = shopRows[0].shopId
  const rows = await db.select().from(records).where(eq(records.shopId, tenantId))
  const state: Record<string, unknown[]> = {}
  for (const row of rows) (state[row.kind] ??= []).push(JSON.parse(row.data))
  const { slots, error } = generateTimeSlots(date, state.bookingChannels as never[] || [], state.availabilityRules as never[] || [], state.appointments as never[] || [])
  return NextResponse.json({ slots, message: error })
}
