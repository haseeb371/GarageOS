type Row = Record<string, unknown> & { id: string }

export type CountLine = {
  itemId: string
  systemQty: number
  countedQty: number
}

export function cycleCountVariances(lines: CountLine[] = []) {
  return lines.filter(line => line.countedQty !== line.systemQty)
}

export function cycleCountTransaction(item: Row, systemQty: number, countedQty: number) {
  const delta = countedQty - systemQty
  return {
    id: `IT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'Cycle count',
    itemId: item.id,
    sku: item.sku,
    itemName: item.name,
    quantity: delta,
    note: `Physical count adjusted ${systemQty} → ${countedQty}`,
    createdAt: new Date().toISOString()
  }
}

export function applyCycleCount(item: Row, countedQty: number) {
  return { ...item, onHand: countedQty }
}
