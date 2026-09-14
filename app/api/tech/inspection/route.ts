import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { buildDraftInspection } from '@/lib/techWorkflow'

type Row = Record<string, unknown> & { id: string }

const getQuery = z.object({
  orderId: z.string().min(1),
  inspectionId: z.string().optional()
})

const patchBody = z.object({
  orderId: z.string().min(1),
  inspectionId: z.string().optional(),
  createIfMissing: z.boolean().optional(),
  itemId: z.string().optional(),
  result: z.enum(['Not inspected', 'Good', 'Monitor', 'Needs attention']).optional(),
  note: z.string().optional(),
  measurement: z.string().optional(),
  complete: z.boolean().optional()
})

export const dynamic = 'force-dynamic'

async function shopInspections(shopId: string) {
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.shopId, shopId), eq(records.kind, 'inspections')))
  return rows.map(row => ({ row, data: JSON.parse(row.data) as Row }))
}

export async function GET(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getQuery.safeParse({
    orderId: url.searchParams.get('orderId') || '',
    inspectionId: url.searchParams.get('inspectionId') || undefined
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide orderId.' }, { status: 400 })
  }

  const inspections = await shopInspections(user.shopId)
  const match = parsed.data.inspectionId
    ? inspections.find(i => i.data.id === parsed.data.inspectionId)
    : inspections.find(i => i.data.orderId === parsed.data.orderId)

  if (!match) {
    return NextResponse.json({ state: 'missing', orderId: parsed.data.orderId })
  }

  return NextResponse.json({
    state: 'open',
    inspection: {
      id: match.data.id,
      orderId: match.data.orderId,
      status: match.data.status,
      template: match.data.template,
      items: match.data.items || []
    }
  })
}

export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor', 'Technician'].includes(user.role)) {
    return NextResponse.json({ error: 'Your role cannot update inspections.' }, { status: 403 })
  }

  const parsed = patchBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid inspection update.' }, { status: 400 })
  }

  const now = Date.now()
  try {
    const result = await db.transaction(async tx => {
      const [orderRow] = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.id, parsed.data.orderId),
            eq(records.kind, 'orders'),
            eq(records.shopId, user.shopId)
          )
        )
        .limit(1)
      if (!orderRow) throw new Error('Repair order not found.')

      const rows = await tx
        .select()
        .from(records)
        .where(and(eq(records.shopId, user.shopId), eq(records.kind, 'inspections')))
      let match = parsed.data.inspectionId
        ? rows.find(r => JSON.parse(r.data).id === parsed.data.inspectionId)
        : rows.find(r => JSON.parse(r.data).orderId === parsed.data.orderId)

      let inspection: Row
      if (!match) {
        if (!parsed.data.createIfMissing) throw new Error('No inspection linked to this repair order.')
        inspection = buildDraftInspection(parsed.data.orderId, user.name)
        await tx.insert(records).values({
          id: inspection.id,
          kind: 'inspections',
          shopId: user.shopId,
          data: JSON.stringify({ ...inspection, shopId: user.shopId }),
          createdAt: now,
          updatedAt: now
        })
      } else {
        inspection = JSON.parse(match.data) as Row
      }

      if (parsed.data.itemId) {
        const items = Array.isArray(inspection.items) ? [...(inspection.items as Row[])] : []
        const index = items.findIndex(item => item.id === parsed.data.itemId)
        if (index < 0) throw new Error('Inspection checkpoint not found.')
        items[index] = {
          ...items[index],
          ...(parsed.data.result ? { result: parsed.data.result } : {}),
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          ...(parsed.data.measurement !== undefined ? { measurement: parsed.data.measurement } : {})
        }
        inspection = { ...inspection, items }
      }

      if (parsed.data.complete) {
        inspection = {
          ...inspection,
          status: 'Completed',
          completedAt: new Date(now).toISOString()
        }
      }

      const clean = { ...inspection, shopId: user.shopId }
      if (match) {
        await tx
          .update(records)
          .set({ data: JSON.stringify(clean), updatedAt: now })
          .where(and(eq(records.id, match.id), eq(records.shopId, user.shopId)))
      }

      await tx.insert(auditLog).values({
        actor: user.id,
        action: parsed.data.createIfMissing && !match ? 'tech.inspection_create' : 'tech.inspection_update',
        entity: 'inspections',
        entityId: String(clean.id),
        detail: `Tech bay update for ${parsed.data.orderId}`,
        createdAt: now
      })

      return clean as Row
    })

    return NextResponse.json({
      ok: true,
      inspection: {
        id: result.id,
        orderId: String(result.orderId || ''),
        status: String(result.status || ''),
        template: String(result.template || ''),
        items: (result.items as Row[]) || []
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update inspection.' },
      { status: 400 }
    )
  }
}
