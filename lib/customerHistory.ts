type Row = Record<string, unknown> & { id: string }

export type HistoryEvent = {
  id: string
  at: string
  kind: string
  label: string
  detail: string
  amount?: number
}

function stamp(value: unknown) {
  return String(value || '').slice(0, 10)
}

export function customerHistory(
  data: Record<string, Row[]>,
  customerId: string,
  vehicleId?: string
) {
  const events: HistoryEvent[] = []
  const matchVehicle = (record: Row) => !vehicleId || record.vehicleId === vehicleId

  for (const appointment of data.appointments || []) {
    if (appointment.customerId !== customerId || !matchVehicle(appointment)) continue
    events.push({
      id: appointment.id,
      at: stamp(appointment.date),
      kind: 'appointments',
      label: 'Appointment',
      detail: `${appointment.time || ''} · ${appointment.service || 'Service'} · ${appointment.status}`
    })
  }

  for (const order of data.orders || []) {
    if (order.customerId !== customerId || !matchVehicle(order)) continue
    events.push({
      id: order.id,
      at: stamp(order.completedAt || order.createdAt),
      kind: 'orders',
      label: 'Repair order',
      detail: `${order.status} · ${(order.jobs as Row[] | undefined)?.length || 0} job(s)`
    })
  }

  for (const invoice of data.invoices || []) {
    if (invoice.customerId !== customerId) continue
    events.push({
      id: invoice.id,
      at: stamp(invoice.issuedAt || invoice.due),
      kind: 'invoices',
      label: 'Invoice',
      detail: `${invoice.status} · balance ${invoice.balance}`,
      amount: Number(invoice.total || 0)
    })
  }

  for (const payment of data.payments || []) {
    const invoice = (data.invoices || []).find(row => row.id === payment.invoiceId)
    if (!invoice || invoice.customerId !== customerId) continue
    events.push({
      id: payment.id,
      at: stamp(payment.date),
      kind: 'payments',
      label: 'Payment',
      detail: `${payment.method} · ${payment.status} · ${payment.invoiceId}`,
      amount: Number(payment.amount || 0)
    })
  }

  for (const inspection of data.inspections || []) {
    const order = (data.orders || []).find(row => row.id === inspection.orderId)
    if (!order || order.customerId !== customerId || !matchVehicle(order)) continue
    events.push({
      id: inspection.id,
      at: stamp(inspection.date || inspection.completedAt),
      kind: 'inspections',
      label: 'Inspection',
      detail: `${inspection.template || 'Inspection'} · ${inspection.status || 'Draft'}`
    })
  }

  for (const service of data.tireServices || []) {
    if (!matchVehicle(service)) continue
    const vehicle = (data.vehicles || []).find(row => row.id === service.vehicleId)
    if (vehicle?.customerId !== customerId) continue
    events.push({
      id: service.id,
      at: stamp(service.date),
      kind: 'tireServices',
      label: 'Tire service',
      detail: `${service.service || 'Service'} · ${service.position || 'All positions'}`
    })
  }

  return events.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}
