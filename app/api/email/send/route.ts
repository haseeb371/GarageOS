import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { sendEmail } from '@/lib/email'
import { buildInvoicePrintHtml } from '@/lib/invoiceDelivery'
import { lowStockItems } from '@/lib/inventoryAlerts'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  type: z.enum(['invoice', 'low-stock', 'test']),
  invoiceId: z.string().optional(),
  locationId: z.string().nullable().optional(),
  to: z.string().email().optional()
})

async function shopData(shopId: string) {
  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(grouped[row.kind] ||= []).push(data)
  }
  return grouped
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid email request.')

  const data = await shopData(user.shopId)
  const shop = (data.shops || [])[0] || { id: user.shopId, name: 'AutoGaragify' }

  if (parsed.data.type === 'test') {
    const to = parsed.data.to || user.email
    if (!to) return responseError('Sign in with an account that has an email, or pass to.')
    const result = await sendEmail({
      to,
      subject: `AutoGaragify test email · ${shop.name || 'Shop'}`,
      html: `<p>This is a live test from <strong>AutoGaragify</strong>.</p><p>Shop: ${shop.name || user.shopId}</p><p>If you received this, Resend is configured correctly.</p>`
    })
    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
    return NextResponse.json({ ok: true, id: result.id, to, mode: 'live' })
  }

  if (parsed.data.type === 'invoice') {
    const invoice = (data.invoices || []).find(row => row.id === parsed.data.invoiceId)
    if (!invoice) return responseError('Invoice not found.')
    const customer = (data.customers || []).find(row => row.id === invoice.customerId)
    if (!customer) return responseError('Invoice customer not found.')
    const to = String(customer.email || '').trim()
    if (!to) return responseError('Customer has no email address. Add one on the customer record first.')

    const order = (data.orders || []).find(row => row.id === invoice.orderId)
    const locationShop =
      (data.shops || []).find(row => row.id === (invoice.locationId || order?.locationId)) || shop
    const html = buildInvoicePrintHtml(invoice, {
      shop: locationShop,
      customer,
      order,
      payments: data.payments || []
    })

    const result = await sendEmail({
      to,
      subject: `Invoice ${invoice.id} from ${locationShop.name || 'AutoGaragify'}`,
      html
    })

    const log = {
      id: `IT-${Date.now()}`,
      type: result.ok ? 'Invoice email' : 'Invoice email failed',
      itemId: String(invoice.id),
      sku: String(invoice.orderId || ''),
      itemName: `Invoice ${invoice.id}`,
      quantity: 0,
      note: result.ok
        ? `Live email sent to ${to} via Resend${result.id ? ` (${result.id})` : ''}.`
        : `Email failed for ${to}: ${result.error}`,
      createdAt: new Date().toISOString(),
      alertChannel: result.ok ? 'Email live' : 'Email failed',
      shopId: user.shopId
    }
    const now = Date.now()
    await db.insert(records).values({
      id: log.id,
      kind: 'inventoryTransactions',
      shopId: user.shopId,
      data: JSON.stringify(log),
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing()

    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
    return NextResponse.json({ ok: true, id: result.id, to, mode: 'live' })
  }

  if (parsed.data.type === 'low-stock') {
    const items = lowStockItems(data.inventory || [], parsed.data.locationId)
    if (!items.length) return responseError('No low-stock parts to alert on.')

    const recipients = [
      user.email,
      ...(data.authUsers || []).filter(row => ['Owner', 'Manager'].includes(String(row.role))).map(row => String(row.email || '')),
      process.env.SUPPORT_EMAIL || ''
    ]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)

    const unique = Array.from(new Set(recipients))
    if (!unique.length) return responseError('No staff email addresses available for low-stock alerts.')

    const locationLabel = parsed.data.locationId
      ? String((data.shops || []).find(row => row.id === parsed.data.locationId)?.name || '')
      : ''
    const lines = items
      .map(item => `<li><strong>${item.name}</strong> (${item.sku}): ${item.onHand} on hand, reorder at ${item.reorderAt}</li>`)
      .join('')
    const html = `<p>Low-stock alert from <strong>${shop.name || 'AutoGaragify'}</strong>${locationLabel ? ` · ${locationLabel}` : ''}.</p><ul>${lines}</ul>`

    const result = await sendEmail({
      to: unique,
      subject: `Low stock · ${items.length} part${items.length === 1 ? '' : 's'} · ${shop.name || 'AutoGaragify'}`,
      html
    })

    const log = {
      id: `IT-${Date.now()}`,
      type: result.ok ? 'Email alert' : 'Email alert failed',
      itemId: String(items[0].id),
      sku: String(items[0].sku || ''),
      itemName: `${items.length} low-stock part${items.length === 1 ? '' : 's'}`,
      quantity: items.length,
      note: result.ok
        ? `Live low-stock email sent to ${unique.join(', ')} via Resend${result.id ? ` (${result.id})` : ''}.`
        : `Low-stock email failed: ${result.error}`,
      createdAt: new Date().toISOString(),
      alertChannel: result.ok ? 'Email live' : 'Email failed',
      shopId: user.shopId
    }
    const now = Date.now()
    await db.insert(records).values({
      id: log.id,
      kind: 'inventoryTransactions',
      shopId: user.shopId,
      data: JSON.stringify(log),
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing()

    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
    return NextResponse.json({ ok: true, id: result.id, to: unique, mode: 'live', count: items.length })
  }

  return responseError('Unsupported email type.')
}
