type Row = Record<string, unknown> & { id: string }

export function lowStockItems(inventory: Row[] = [], locationId?: string | null) {
  return inventory.filter(item => {
    if (locationId && item.locationId && item.locationId !== locationId) return false
    return Number(item.onHand) <= Number(item.reorderAt)
  })
}

export function buildLowStockAlertLog(items: Row[], shopName: string, locationLabel = '') {
  if (!items.length) return null
  const locationSuffix = locationLabel ? ` · ${locationLabel}` : ''
  return {
    id: `IT-${Date.now()}`,
    type: 'Email alert',
    itemId: String(items[0].id),
    sku: String(items[0].sku || ''),
    itemName: `${items.length} low-stock part${items.length === 1 ? '' : 's'}`,
    quantity: items.length,
    note: [
      `Sandbox email from ${shopName || 'AutoGaragify'} would notify shop staff${locationSuffix}:`,
      ...items.map(
        item =>
          `${item.name} (${item.sku}): ${item.onHand} on hand, reorder at ${item.reorderAt}`
      ),
      'Connect RESEND_API_KEY and EMAIL_FROM for live email delivery.'
    ].join(' · '),
    createdAt: new Date().toISOString(),
    alertChannel: 'Email sandbox'
  }
}
