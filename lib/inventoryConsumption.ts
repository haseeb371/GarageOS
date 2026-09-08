type Row = Record<string, unknown> & { id: string }

export function shouldConsumeParts(previous: Row | undefined, order: Row) {
  if (String(order.status) !== 'Completed') return false
  if (previous && String(previous.status) === 'Completed') return false
  if (order.partsDeductedAt) return false
  return true
}

function findInventoryBySku(inventory: Row[], sku: string) {
  const normalized = String(sku || '').trim().toLowerCase()
  if (!normalized) return null
  return inventory.find(item => String(item.sku || '').trim().toLowerCase() === normalized) || null
}

export function consumptionPlan(
  order: Row,
  inventory: Row[] = [],
  partsOrders: Row[] = []
) {
  const lines: Array<{ itemId: string; qty: number; note: string }> = []
  const seen = new Set<string>()

  for (const partsOrder of partsOrders.filter(
    row => row.repairOrderId === order.id && String(row.status) === 'Received'
  )) {
    const item = findInventoryBySku(inventory, String(partsOrder.partNumber || ''))
    if (!item) continue
    const qty = Number(partsOrder.receivedQuantity || partsOrder.quantity || 0)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const key = `${item.id}:${partsOrder.id}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({
      itemId: String(item.id),
      qty,
      note: `Consumed from parts order ${partsOrder.id} on ${order.id}`
    })
  }

  const approvedJobs = (Array.isArray(order.jobs) ? (order.jobs as Row[]) : []).filter(
    job => job.decision === 'Approved'
  )
  for (const job of approvedJobs) {
    const itemId = String(job.inventoryItemId || '')
    if (itemId) {
      const qty = Number(job.partsQty || 1)
      if (qty <= 0) continue
      const key = `job:${job.id}:${itemId}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push({
        itemId,
        qty,
        note: `Consumed for approved job ${job.name || job.id} on ${order.id}`
      })
      continue
    }
    const sku = String(job.partsSku || '')
    if (sku) {
      const item = findInventoryBySku(inventory, sku)
      if (!item) continue
      const qty = Number(job.partsQty || 1)
      const key = `job-sku:${job.id}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push({
        itemId: String(item.id),
        qty,
        note: `Consumed SKU ${sku} for ${job.name || job.id} on ${order.id}`
      })
    }
  }

  return lines
}

export function consumptionEffects(
  order: Row,
  inventory: Row[] = [],
  partsOrders: Row[] = []
) {
  const plan = consumptionPlan(order, inventory, partsOrders)
  const inventoryUpdates: Row[] = []
  const transactions: Row[] = []
  const stamp = new Date().toISOString()

  for (const line of plan) {
    const item = inventory.find(row => row.id === line.itemId)
    if (!item) continue
    const onHand = Number(item.onHand || 0)
    const nextOnHand = Math.max(0, onHand - line.qty)
    inventoryUpdates.push({ ...item, onHand: nextOnHand })
    transactions.push({
      id: `IT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'RO consumption',
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
      quantity: -line.qty,
      note: line.note,
      orderId: order.id,
      createdAt: stamp
    })
  }

  return {
    inventoryUpdates,
    transactions,
    orderPatch: { partsDeductedAt: stamp }
  }
}
