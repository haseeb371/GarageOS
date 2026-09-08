type Row = Record<string, unknown> & { id: string }

export function itemsOnOpenOrders(purchaseOrders: Row[]) {
  const itemIds = new Set<string>()
  for (const po of purchaseOrders) {
    if (['Received', 'Cancelled'].includes(String(po.status))) continue
    for (const line of (po.items as Row[]) || []) {
      if (Number(line.ordered) > Number(line.received || 0)) itemIds.add(String(line.itemId))
    }
  }
  return itemIds
}

export function draftLowStockPurchaseOrders(inventory: Row[], purchaseOrders: Row[], locationId?: string | null) {
  const onOrder = itemsOnOpenOrders(purchaseOrders)
  const lowStock = inventory.filter(item => {
    if (locationId && item.locationId && item.locationId !== locationId) return false
    return Number(item.onHand) <= Number(item.reorderAt)
  }).filter(item => item.vendorId && !onOrder.has(item.id))

  const byVendor = new Map<string, Row[]>()
  for (const item of lowStock) {
    const vendorId = String(item.vendorId)
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, [])
    byVendor.get(vendorId)!.push(item)
  }

  const stamp = Date.now()
  return Array.from(byVendor.entries()).map(([vendorId, items], index) => {
    const lines = items.map(item => {
      const reorderAt = Number(item.reorderAt)
      const onHand = Number(item.onHand)
      const quantity = Math.max(1, reorderAt * 2 - onHand)
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        ordered: quantity,
        received: 0,
        cost: Number(item.cost || 0)
      }
    })
    const total = lines.reduce((sum, line) => sum + Number(line.cost) * Number(line.ordered), 0)
    return {
      id: `PO-${String(stamp).slice(-6)}-${index + 1}`,
      vendorId,
      status: 'Draft',
      expected: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      total,
      items: lines,
      locationId: locationId || '',
      source: 'Low stock auto-draft',
      createdAt: new Date().toISOString()
    }
  })
}
