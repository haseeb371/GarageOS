type Row = Record<string, unknown> & { id: string }

export function remindersFromCompletedOrder(order: Row, vehicle?: Row) {
  const jobs = (Array.isArray(order.jobs) ? order.jobs as Row[] : []).filter(job => job.decision === 'Approved')
  if (!jobs.length) return [] as Row[]
  const mileage = Number(vehicle?.mileage || 0)
  const dueDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const dueMileage = mileage ? mileage + 5000 : 0
  return jobs.map(job => ({
    id: `SR-${order.id}-${job.id}-${Date.now().toString().slice(-4)}`,
    customerId: String(order.customerId || ''),
    vehicleId: String(order.vehicleId || ''),
    orderId: String(order.id),
    jobId: String(job.id),
    service: String(job.name || 'Follow-up service'),
    dueDate,
    dueMileage,
    status: 'Due soon',
    channel: 'SMS sandbox',
    lastSentAt: null,
    notes: `Auto-created when repair order ${order.id} was completed.`,
    autoCreated: true
  }))
}

export function shouldCreateReminders(existing: Row[], order: Row, previous?: Row) {
  if (String(order.status) !== 'Completed') return false
  if (previous && String(previous.status) === 'Completed') return false
  const keys = new Set(existing.filter(r => r.orderId === order.id).map(r => `${r.jobId}:${r.service}`))
  return remindersFromCompletedOrder(order).some(r => !keys.has(`${r.jobId}:${r.service}`))
}
