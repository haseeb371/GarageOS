type Row = Record<string, unknown> & { id: string }

export function isFleetCustomer(customer?: Row | null) {
  if (!customer) return false
  if (customer.fleetAccount === true || customer.accountType === 'Fleet') return true
  const tags = Array.isArray(customer.tags) ? customer.tags.map(String) : []
  return tags.some(tag => tag.toLowerCase() === 'fleet')
}

export function fleetVehicles(vehicles: Row[] = [], customerId: string) {
  return vehicles.filter(v => v.customerId === customerId)
}

export function fleetOpenBalance(invoices: Row[] = [], customerId: string) {
  return invoices
    .filter(inv => inv.customerId === customerId && String(inv.status) !== 'Void')
    .reduce((sum, inv) => sum + Number(inv.balance || 0), 0)
}

export type FleetStatementLine = {
  date: string
  type: 'Invoice' | 'Payment'
  reference: string
  vehicle: string
  description: string
  charge: number
  payment: number
  balance: number
}

function stamp(value: unknown) {
  return String(value || '').slice(0, 10)
}

function inRange(date: string, from: string, to: string) {
  if (!date) return false
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

/** Build an open-item style statement for a fleet (or any) customer. */
export function buildFleetStatement(input: {
  customer: Row
  invoices?: Row[]
  payments?: Row[]
  orders?: Row[]
  vehicles?: Row[]
  from: string
  to: string
}) {
  const customerId = String(input.customer.id)
  const vehicleById = new Map((input.vehicles || []).map(v => [v.id, v]))
  const orderById = new Map((input.orders || []).map(o => [o.id, o]))

  type Raw = { date: string; type: 'Invoice' | 'Payment'; reference: string; vehicle: string; description: string; charge: number; payment: number }
  const raw: Raw[] = []

  for (const inv of input.invoices || []) {
    if (inv.customerId !== customerId || String(inv.status) === 'Void') continue
    const date = stamp(inv.issuedAt || inv.due || inv.date)
    if (!inRange(date, input.from, input.to)) continue
    const order = orderById.get(String(inv.orderId || ''))
    const vehicle = order ? vehicleById.get(String(order.vehicleId || '')) : undefined
    const vehicleLabel = vehicle
      ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || String(vehicle.id)
      : ''
    raw.push({
      date,
      type: 'Invoice',
      reference: String(inv.id),
      vehicle: vehicleLabel,
      description: String(inv.notes || `Invoice ${inv.id}${inv.purchaseOrder ? ` · PO ${inv.purchaseOrder}` : ''}`),
      charge: Number(inv.total || 0),
      payment: 0
    })
  }

  for (const payment of input.payments || []) {
    const invoice = (input.invoices || []).find(inv => inv.id === payment.invoiceId)
    if (!invoice || invoice.customerId !== customerId) continue
    const date = stamp(payment.date)
    if (!inRange(date, input.from, input.to)) continue
    raw.push({
      date,
      type: 'Payment',
      reference: String(payment.id),
      vehicle: '',
      description: `${payment.method || 'Payment'} · ${payment.status || ''}`.trim(),
      charge: 0,
      payment: Number(payment.amount || 0)
    })
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference))

  let running = 0
  const lines: FleetStatementLine[] = raw.map(row => {
    running += row.charge - row.payment
    return { ...row, balance: Math.round(running * 100) / 100 }
  })

  const opening = 0
  const charges = lines.reduce((s, l) => s + l.charge, 0)
  const payments = lines.reduce((s, l) => s + l.payment, 0)
  const closing = Math.round((opening + charges - payments) * 100) / 100
  const openBalance = fleetOpenBalance(input.invoices || [], customerId)

  return {
    customerId,
    customerName: String(input.customer.name || customerId),
    billingEmail: String(input.customer.billingEmail || input.customer.email || ''),
    netTermsDays: Number(input.customer.netTermsDays || 30),
    poRequired: Boolean(input.customer.poRequired),
    from: input.from,
    to: input.to,
    opening,
    charges: Math.round(charges * 100) / 100,
    payments: Math.round(payments * 100) / 100,
    closing,
    openBalance: Math.round(openBalance * 100) / 100,
    lines
  }
}

export function fleetStatementToCsv(statement: ReturnType<typeof buildFleetStatement>) {
  const escape = (value: unknown) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }
  const header = ['Date', 'Type', 'Reference', 'Vehicle', 'Description', 'Charge', 'Payment', 'Running balance']
  const rows = statement.lines.map(line =>
    [line.date, line.type, line.reference, line.vehicle, line.description, line.charge.toFixed(2), line.payment.toFixed(2), line.balance.toFixed(2)]
      .map(escape)
      .join(',')
  )
  const summary = [
    '',
    `Customer,${escape(statement.customerName)}`,
    `Period,${escape(statement.from)} to ${escape(statement.to)}`,
    `Net terms (days),${statement.netTermsDays}`,
    `PO required,${statement.poRequired ? 'Yes' : 'No'}`,
    `Charges,${statement.charges.toFixed(2)}`,
    `Payments,${statement.payments.toFixed(2)}`,
    `Period closing,${statement.closing.toFixed(2)}`,
    `Open A/R now,${statement.openBalance.toFixed(2)}`
  ]
  return [header.join(','), ...rows, ...summary].join('\n')
}

export function defaultStatementRange(now = new Date()) {
  const to = now.toISOString().slice(0, 10)
  const fromDate = new Date(now)
  fromDate.setDate(1)
  const from = fromDate.toISOString().slice(0, 10)
  return { from, to }
}
