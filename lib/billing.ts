type Row = Record<string, unknown> & { id: string }

export function creditApplicationAmount(invoice: Row, customer: Row) {
  const balance = Number(invoice.balance || 0)
  const credit = Number(customer.credit || 0)
  if (balance <= 0 || credit <= 0) return 0
  return Math.min(balance, credit)
}

export function invoicesEligibleForCredit(invoices: Row[] = [], customers: Row[] = []) {
  return invoices.filter(invoice => {
    if (Number(invoice.balance) <= 0) return false
    const customer = customers.find(row => row.id === invoice.customerId)
    return Number(customer?.credit || 0) > 0
  })
}
