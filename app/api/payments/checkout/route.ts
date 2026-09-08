import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { createCheckoutSession } from '@/lib/stripe'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  invoiceId: z.string().min(1)
})

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!['Owner', 'Manager', 'Advisor', 'Bookkeeper'].includes(user.role)) {
    return responseError(`${user.role} access cannot start card payments.`, 403)
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid payment request.')

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const invoiceRow = rows.find(row => row.kind === 'invoices' && JSON.parse(row.data).id === parsed.data.invoiceId)
  if (!invoiceRow) return responseError('Invoice not found.')

  const invoice = JSON.parse(invoiceRow.data) as Row
  const balance = Number(invoice.balance || 0)
  if (balance <= 0) return responseError('This invoice has no outstanding balance.')

  const customerRow = rows.find(row => row.kind === 'customers' && JSON.parse(row.data).id === invoice.customerId)
  const customer = customerRow ? (JSON.parse(customerRow.data) as Row) : undefined
  const shops = rows.filter(row => row.kind === 'shops').map(row => JSON.parse(row.data) as Row)
  const shop =
    shops.find(row => row.id === invoice.locationId) ||
    shops[0] ||
    { currency: 'USD', name: 'AutoGaragify' }

  const result = await createCheckoutSession({
    invoiceId: String(invoice.id),
    amount: balance,
    currency: String(shop.currency || 'USD'),
    customerEmail: customer?.email ? String(customer.email) : undefined,
    customerName: customer?.name ? String(customer.name) : undefined,
    description: `Invoice ${invoice.id} · ${shop.name || 'AutoGaragify'}`
  })

  if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
  return NextResponse.json({ ok: true, url: result.url, sessionId: result.id, mode: 'stripe' })
}
