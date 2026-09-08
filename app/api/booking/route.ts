import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'
import { validateBookingTime } from '@/lib/booking'
import { planAutomationsForSave } from '@/lib/automationRuntime'

const input = z.object({
  shopId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(7).max(30),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1),
  make: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  mileage: z.coerce.number().int().min(0).max(2000000),
  date: z.string().date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  service: z.string().trim().min(3).max(500)
})

const attempts = new Map<string, { count: number; reset: number }>()

export async function POST(request: Request) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'
  const nowMs = Date.now()
  const bucket = attempts.get(key)
  if (bucket && bucket.reset > nowMs && bucket.count >= 8) {
    return NextResponse.json({ error: 'Too many booking attempts. Please try again later.' }, { status: 429 })
  }
  attempts.set(key, { count: bucket && bucket.reset > nowMs ? bucket.count + 1 : 1, reset: bucket && bucket.reset > nowMs ? bucket.reset : nowMs + 3600000 })

  const parsed = input.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Check the booking details.' }, { status: 400 })

  const shopRows = await db.select().from(records).where(and(eq(records.id, parsed.data.shopId), eq(records.kind, 'shops')))
  if (!shopRows.length) return NextResponse.json({ error: 'Booking page not found.' }, { status: 404 })
  const tenantId = shopRows[0].shopId
  const rows = await db.select().from(records).where(eq(records.shopId, tenantId))
  const state: Record<string, unknown[]> = {}
  for (const row of rows) (state[row.kind] ??= []).push(JSON.parse(row.data))

  const validation = validateBookingTime(
    parsed.data.date,
    parsed.data.time,
    state.bookingChannels as never[] || [],
    state.availabilityRules as never[] || [],
    state.appointments as never[] || []
  )
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const customerId = `C-${randomUUID().slice(0, 8)}`
  const vehicleId = `V-${randomUUID().slice(0, 8)}`
  const appointmentId = `A-${randomUUID().slice(0, 8)}`
  const created = Date.now()
  const customer = { id: customerId, name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone, credit: 0, tags: ['Online booking'], notes: 'Created through public booking' }
  const vehicle = { id: vehicleId, customerId, year: parsed.data.year, make: parsed.data.make, model: parsed.data.model, mileage: parsed.data.mileage, vin: '', plate: '', fleet: false }
  const appointment = { id: appointmentId, customerId, vehicleId, locationId: parsed.data.shopId, date: parsed.data.date, time: parsed.data.time, service: parsed.data.service, status: 'Pending', source: 'Online booking' }

  const automations = planAutomationsForSave('appointments', appointment, (state.workflowAutomations as never[]) || [], {
    previous: null,
    customers: (state.customers as never[]) || [],
    vehicles: (state.vehicles as never[]) || [],
    orders: (state.orders as never[]) || [],
    invoices: (state.invoices as never[]) || [],
    inventory: (state.inventory as never[]) || [],
    shops: (state.shops as never[]) || [],
    appointments: [...((state.appointments as never[]) || []), appointment as never],
    payments: (state.payments as never[]) || [],
    automationJobs: (state.automationJobs as never[]) || []
  })

  await db.transaction(async tx => {
    for (const [kind, data] of [['customers', customer], ['vehicles', vehicle], ['appointments', appointment]] as const) {
      await tx.insert(records).values({ id: data.id, kind, shopId: tenantId, data: JSON.stringify({ ...data, shopId: tenantId }), createdAt: created, updatedAt: created })
    }
    for (const effect of automations) {
      await tx.insert(records).values({
        id: effect.record.id,
        kind: effect.kind,
        shopId: tenantId,
        data: JSON.stringify({ ...effect.record, shopId: tenantId }),
        createdAt: created,
        updatedAt: created
      }).onConflictDoUpdate({
        target: records.id,
        set: { data: JSON.stringify({ ...effect.record, shopId: tenantId }), updatedAt: created }
      })
    }
    await tx.insert(auditLog).values({ actor: 'public-booking', action: 'create', entity: 'appointments', entityId: appointmentId, detail: `Online booking requested by ${parsed.data.name}`, createdAt: created })
  })

  return NextResponse.json({ ok: true, appointmentId })
}
