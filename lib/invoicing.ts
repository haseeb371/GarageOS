import { orderTotal } from './booking'

type Row = Record<string, unknown> & { id: string }

export function invoiceForOrder(order: Row, existingInvoices: Row[] = []) {
  const existing = existingInvoices.find(
    invoice => invoice.orderId === order.id && invoice.status !== 'Void'
  )
  if (existing) return null
  const total = Math.round(orderTotal(order) * 100) / 100
  if (total <= 0) return null
  return {
    id: `INV-${Date.now().toString().slice(-5)}`,
    orderId: order.id,
    customerId: String(order.customerId || ''),
    locationId: order.locationId || '',
    total,
    balance: total,
    status: 'Due',
    due: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    issuedAt: new Date().toISOString().slice(0, 10),
    notes: `Created from repair order ${order.id}`
  }
}

export function ordersReadyToInvoice(orders: Row[] = [], invoices: Row[] = []) {
  return orders.filter(order => order.status === 'Completed' && invoiceForOrder(order, invoices))
}
