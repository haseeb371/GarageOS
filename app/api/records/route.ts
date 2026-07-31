import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { records, auditLog } from '@/lib/schema'
import { kinds, type Kind } from '@/lib/domain'
import { canWrite, currentUser } from '@/lib/auth'

type Row = Record<string, unknown> & { id: string }
const payload = z.object({
  kind: z.enum(kinds),
  record: z.record(z.string(), z.unknown()).and(z.object({ id: z.string().trim().min(1).max(100) }))
})
const orderStatuses = ['Estimate', 'Authorized', 'In progress', 'Ready', 'Completed']

function responseError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.'
  return NextResponse.json({ error: message }, { status })
}

async function shopRows(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], shopId: string) {
  const rows = await tx.select().from(records).where(eq(records.shopId, shopId))
  return rows.map(row => ({ kind: row.kind as Kind, data: JSON.parse(row.data) as Row }))
}

function find(all: Awaited<ReturnType<typeof shopRows>>, kind: Kind, id: unknown) {
  return all.find(row => row.kind === kind && row.data.id === id)?.data
}

function validate(kind: Kind, record: Row, all: Awaited<ReturnType<typeof shopRows>>) {
  const requiredText = (key: string, label: string) => {
    if (typeof record[key] !== 'string' || !String(record[key]).trim()) throw new Error(`${label} is required.`)
  }
  if (kind === 'customers') {
    requiredText('name', 'Customer name')
    if (record.email && !z.string().email().safeParse(record.email).success) throw new Error('Enter a valid customer email address.')
  }
  if (kind === 'vehicles') {
    if (!find(all, 'customers', record.customerId)) throw new Error('Select an existing customer for this vehicle.')
    requiredText('make', 'Vehicle make'); requiredText('model', 'Vehicle model')
    if (record.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(String(record.vin))) throw new Error('VIN must contain 17 valid characters (I, O and Q are not used).')
  }
  if (kind === 'appointments' || kind === 'orders') {
    const customer = find(all, 'customers', record.customerId)
    const vehicle = find(all, 'vehicles', record.vehicleId)
    if (!customer || !vehicle) throw new Error('Select an existing customer and vehicle.')
    if (vehicle.customerId !== customer.id) throw new Error('The selected vehicle does not belong to this customer.')
  }
  if (kind === 'appointments') requiredText('service', 'Requested service')
  if (kind === 'orders') {
    if (!orderStatuses.includes(String(record.status))) throw new Error('Invalid repair-order status.')
    const jobs = Array.isArray(record.jobs) ? record.jobs : []
    for (const job of jobs as Row[]) {
      if (!job.name || Number(job.laborHours) < 0 || Number(job.laborRate) < 0 || Number(job.partsPrice) < 0) {
        throw new Error('Every service job needs a name and non-negative pricing.')
      }
    }
  }
  if (kind === 'inventory') {
    requiredText('sku', 'SKU'); requiredText('name', 'Part name')
    if (Number(record.onHand) < 0 || Number(record.cost) < 0 || Number(record.price) < 0) throw new Error('Inventory quantities and prices cannot be negative.')
  }
  if (kind === 'cannedJobs') {
    requiredText('name', 'Service name'); requiredText('category', 'Job category')
    for (const key of ['laborHours','laborRate','partsCost','partsPrice','packagePrice']) if (Number(record[key] || 0) < 0) throw new Error('Canned-job pricing cannot be negative.')
  }
  if (kind === 'pricingRules') {
    requiredText('name', 'Pricing-rule name')
    if (!['Labor rate','Parts matrix','Shop fee'].includes(String(record.type))) throw new Error('Select a valid pricing-rule type.')
    for (const key of ['minCost','maxCost','markupPercent','amount','cap']) if (Number(record[key] || 0) < 0) throw new Error('Pricing-rule values cannot be negative.')
    if (record.type === 'Parts matrix' && Number(record.maxCost) < Number(record.minCost)) throw new Error('Maximum cost must be at least the minimum cost.')
  }
  if (kind === 'warranties') {
    requiredText('name', 'Warranty name'); requiredText('terms', 'Warranty terms')
    if (Number(record.months || 0) < 0 || Number(record.miles || 0) < 0) throw new Error('Warranty duration cannot be negative.')
  }
  if (kind === 'invoices') {
    if (!find(all, 'customers', record.customerId)) throw new Error('Invoice customer was not found.')
    if (record.orderId && !find(all, 'orders', record.orderId)) throw new Error('Invoice repair order was not found.')
    const total = Number(record.total), balance = Number(record.balance)
    if (!Number.isFinite(total) || total <= 0) throw new Error('Invoice total must be greater than zero.')
    if (!Number.isFinite(balance) || balance < 0 || balance > total) throw new Error('Invoice balance must be between zero and the invoice total.')
    if (balance === 0 && record.status !== 'Paid' && record.status !== 'Void') throw new Error('An unpaid invoice must have an outstanding balance.')
  }
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!canWrite(user.role)) return responseError('Your role cannot change shop records.', 403)
  const parsed = payload.safeParse(await req.json())
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid record.')
  const { kind, record } = parsed.data
  const now = Date.now()
  try {
    await db.transaction(async tx => {
      const all = await shopRows(tx, user.shopId)
      validate(kind, record, all)
      const existing = find(all, kind, record.id)
      if (kind === 'payments' && !existing) {
        const amount = Number(record.amount)
        const invoice = find(all, 'invoices', record.invoiceId)
        if (!invoice) throw new Error('Select an existing invoice before recording payment.')
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.')
        const balance = Number(invoice.balance || 0)
        if (amount > balance + 0.005) throw new Error('Payment cannot be greater than the invoice balance.')
        const nextBalance = Math.max(0, balance - amount)
        const updatedInvoice = { ...invoice, balance: nextBalance, status: nextBalance === 0 ? 'Paid' : 'Partial' }
        await tx.update(records).set({ data: JSON.stringify(updatedInvoice), updatedAt: now }).where(and(eq(records.id, invoice.id), eq(records.shopId, user.shopId)))
      }
      const clean = { ...record, shopId: user.shopId }
      await tx.insert(records).values({ id: record.id, kind, shopId: user.shopId, data: JSON.stringify(clean), createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: records.id, set: { data: JSON.stringify(clean), kind, shopId: user.shopId, updatedAt: now } })
      await tx.insert(auditLog).values({ actor: user.id, action: existing ? 'update' : 'create', entity: kind, entityId: record.id, detail: `${existing ? 'Updated' : 'Created'} ${record.id}`, createdAt: now })
    })
    return NextResponse.json({ ok: true, record })
  } catch (error) { return responseError(error) }
}

export async function DELETE(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!canWrite(user.role)) return responseError('Your role cannot delete shop records.', 403)
  const parsed = z.object({ id: z.string().min(1), kind: z.enum(kinds) }).safeParse(await req.json())
  if (!parsed.success) return responseError('Invalid delete request.')
  const { id, kind } = parsed.data
  try {
    await db.transaction(async tx => {
      const all = await shopRows(tx, user.shopId)
      const dependencies = kind === 'customers'
        ? all.filter(row => ['vehicles', 'appointments', 'orders', 'invoices'].includes(row.kind) && row.data.customerId === id)
        : kind === 'vehicles'
          ? all.filter(row => ['appointments', 'orders'].includes(row.kind) && row.data.vehicleId === id)
          : kind === 'invoices'
            ? all.filter(row => row.kind === 'payments' && row.data.invoiceId === id)
            : []
      if (dependencies.length) throw new Error(`This ${kind.slice(0, -1)} is used by ${dependencies.length} other record(s) and cannot be deleted.`)
      const result = await tx.delete(records).where(and(eq(records.id, id), eq(records.kind, kind), eq(records.shopId, user.shopId))).returning({ id: records.id })
      if (!result.length) throw new Error('Record not found.')
      await tx.insert(auditLog).values({ actor: user.id, action: 'delete', entity: kind, entityId: id, detail: `Deleted ${id}`, createdAt: Date.now() })
    })
    return NextResponse.json({ ok: true })
  } catch (error) { return responseError(error) }
}
