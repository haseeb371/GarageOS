import { NextResponse } from 'next/server'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { partsTechConfigured, partsTechMode, placePartsOrder, searchPartsQuotes } from '@/lib/partstech'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    configured: partsTechConfigured(),
    mode: partsTechMode(),
    message:
      partsTechMode() === 'sandbox'
        ? 'PartsTech sandbox catalog is active — search and place demo orders.'
        : partsTechMode() === 'live'
          ? 'PartsTech live mode enabled.'
          : 'Parts network disabled (PARTSTECH_MODE=off).'
  })
}

const searchSchema = z.object({
  action: z.literal('search'),
  query: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
  orderId: z.string().optional()
})

const orderSchema = z.object({
  action: z.literal('order'),
  quoteId: z.string().min(1),
  orderId: z.string().optional(),
  partNumber: z.string().min(1),
  description: z.string().optional(),
  brand: z.string().optional(),
  supplier: z.string().min(1),
  quantity: z.number().min(1),
  unitCost: z.number().min(0),
  listPrice: z.number().optional(),
  coreCharge: z.number().optional(),
  available: z.number().optional(),
  deliveryEstimate: z.string().optional(),
  source: z.string().optional()
})

export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner, Manager, or Advisor can source parts.' }, { status: 403 })
  }
  if (!partsTechConfigured()) {
    return NextResponse.json({ error: 'Parts network is disabled.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  if (body?.action === 'search') {
    const parsed = searchSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Provide a search query.' }, { status: 400 })
    const quotes = await searchPartsQuotes(parsed.data.query, parsed.data.quantity || 1)
    const now = Date.now()
    const recordsToSave = quotes.map((q, index) => ({
      id: `SQ-${now.toString().slice(-6)}${index}`,
      orderId: parsed.data.orderId || '',
      partNumber: q.partNumber,
      description: q.description,
      quantity: parsed.data.quantity || 1,
      supplier: q.supplier,
      brand: q.brand,
      unitCost: q.unitCost,
      listPrice: q.listPrice,
      coreCharge: q.coreCharge,
      available: q.available,
      deliveryEstimate: q.deliveryEstimate,
      status: 'Quoted',
      source: q.source,
      expiresAt: new Date(now + 2 * 86400000).toISOString().slice(0, 10),
      notes: `Auto-quoted via ${q.source}`,
      shopId: user.shopId
    }))

    await db.transaction(async tx => {
      for (const row of recordsToSave) {
        await tx.insert(records).values({
          id: row.id,
          kind: 'supplierQuotes',
          shopId: user.shopId,
          data: JSON.stringify(row),
          createdAt: now,
          updatedAt: now
        }).onConflictDoNothing()
      }
      await tx.insert(auditLog).values({
        actor: user.id,
        action: 'parts.search',
        entity: 'supplierQuotes',
        entityId: recordsToSave[0]?.id || 'none',
        detail: `Parts search “${parsed.data.query}” → ${recordsToSave.length} quote(s)`,
        createdAt: now
      })
    })

    return NextResponse.json({ ok: true, mode: partsTechMode(), quotes: recordsToSave })
  }

  if (body?.action === 'order') {
    const parsed = orderSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid order payload.' }, { status: 400 })
    const placed = await placePartsOrder({
      quoteId: parsed.data.quoteId,
      partNumber: parsed.data.partNumber,
      supplier: parsed.data.supplier,
      quantity: parsed.data.quantity,
      unitCost: parsed.data.unitCost
    })
    const now = Date.now()
    const order = {
      id: `POR-${now.toString().slice(-6)}`,
      repairOrderId: parsed.data.orderId || '',
      quoteId: parsed.data.quoteId,
      supplier: parsed.data.supplier,
      providerOrderId: placed.providerOrderId,
      partNumber: parsed.data.partNumber,
      description: parsed.data.description || parsed.data.partNumber,
      quantity: parsed.data.quantity,
      total:
        Number(parsed.data.unitCost) * Number(parsed.data.quantity) + Number(parsed.data.coreCharge || 0),
      status: placed.status,
      orderedAt: new Date(now).toISOString(),
      expectedAt: parsed.data.deliveryEstimate || '',
      receivedQuantity: 0,
      tracking: '',
      source: parsed.data.source || 'PartsTech sandbox',
      notes: placed.message,
      shopId: user.shopId
    }
    await db.transaction(async tx => {
      await tx.insert(records).values({
        id: order.id,
        kind: 'partsOrders',
        shopId: user.shopId,
        data: JSON.stringify(order),
        createdAt: now,
        updatedAt: now
      })
      await tx.insert(auditLog).values({
        actor: user.id,
        action: 'parts.order',
        entity: 'partsOrders',
        entityId: order.id,
        detail: placed.message,
        createdAt: now
      })
    })
    return NextResponse.json({ ok: true, order, message: placed.message })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
