import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'

const input = z.object({
  purchaseOrderId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(100000)
})

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Your role cannot receive purchase orders.' }, { status: 403 })
  }
  const parsed = input.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid receive request.' }, { status: 400 })

  try {
    const now = Date.now()
    const result = await db.transaction(async tx => {
      const rows = await tx.select().from(records).where(eq(records.shopId, user.shopId))
      const poRow = rows.find(row => row.kind === 'purchaseOrders' && row.id === parsed.data.purchaseOrderId)
      const inventoryRow = rows.find(row => row.kind === 'inventory' && row.id === parsed.data.itemId)
      if (!poRow) throw new Error('Purchase order not found.')
      if (!inventoryRow) throw new Error('Inventory item not found.')
      const po = JSON.parse(poRow.data) as Record<string, unknown> & { id: string; items?: Array<Record<string, unknown>> }
      const item = JSON.parse(inventoryRow.data) as Record<string, unknown> & { id: string; onHand?: number; cost?: number }
      if (!Array.isArray(po.items)) throw new Error('This purchase order cannot be received.')
      const line = po.items.find(x => x.itemId === parsed.data.itemId)
      if (!line) throw new Error('That part is not on this purchase order.')
      const remaining = Number(line.ordered || 0) - Number(line.received || 0)
      if (parsed.data.quantity > remaining) throw new Error(`Only ${remaining} unit(s) remain to receive.`)

      const lines = po.items.map(x => x.itemId === parsed.data.itemId
        ? { ...x, received: Number(x.received || 0) + parsed.data.quantity }
        : x)
      const complete = lines.every(x => Number(x.received) >= Number(x.ordered))
      const updatedPo = {
        ...po,
        items: lines,
        status: complete ? 'Received' : 'Partially received',
        receivedAt: complete ? new Date(now).toISOString() : po.receivedAt
      }
      const updatedItem = {
        ...item,
        onHand: Number(item.onHand || 0) + parsed.data.quantity,
        cost: Number(line.cost ?? item.cost ?? 0)
      }
      const transaction = {
        id: `IT-${now}`,
        type: 'Receipt',
        itemId: item.id,
        sku: item.sku,
        itemName: item.name,
        quantity: parsed.data.quantity,
        note: `Received against ${po.id}`,
        purchaseOrderId: po.id,
        createdAt: new Date(now).toISOString(),
        shopId: user.shopId
      }

      await tx.update(records).set({ data: JSON.stringify(updatedItem), updatedAt: now }).where(and(eq(records.id, item.id), eq(records.shopId, user.shopId)))
      await tx.update(records).set({ data: JSON.stringify(updatedPo), updatedAt: now }).where(and(eq(records.id, po.id), eq(records.shopId, user.shopId)))
      await tx.insert(records).values({
        id: transaction.id,
        kind: 'inventoryTransactions',
        shopId: user.shopId,
        data: JSON.stringify(transaction),
        createdAt: now,
        updatedAt: now
      })
      await tx.insert(auditLog).values({
        actor: user.id,
        action: 'receive_inventory',
        entity: 'purchaseOrders',
        entityId: po.id,
        detail: `Received ${parsed.data.quantity} of ${item.name}`,
        createdAt: now
      })
      return { purchaseOrder: updatedPo, inventory: updatedItem, transaction }
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Receive failed.' }, { status: 400 })
  }
}
