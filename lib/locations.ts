type Row = Record<string, unknown> & { id: string; locationId?: string }

export const locationScopedKinds = ['appointments', 'orders', 'inventory', 'purchaseOrders', 'invoices'] as const

export function matchesLocation(record: Row, locationId: string | null) {
  if (!locationId) return true
  const recordLocation = String(record.locationId || '')
  return !recordLocation || recordLocation === locationId
}

export function filterByLocation<T extends Row>(rows: T[] | undefined, locationId: string | null) {
  if (!locationId) return rows || []
  return (rows || []).filter(row => matchesLocation(row, locationId))
}

export function locationName(shops: Row[] | undefined, locationId?: string) {
  if (!locationId) return ''
  return String(shops?.find(shop => shop.id === locationId)?.name || locationId)
}

export function scopeStateByLocation(data: Record<string, Row[]>, locationId: string | null) {
  if (!locationId) return data
  const next = { ...data }
  for (const kind of locationScopedKinds) {
    next[kind] = filterByLocation(data[kind], locationId)
  }
  return next
}
