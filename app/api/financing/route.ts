import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { financingConfigured, financingProvider, financingSetupChecklist, buildFinancingOffer, pushFinancingReferral } from '@/lib/financing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const invoiceId = url.searchParams.get('invoiceId')
  const checklist = financingSetupChecklist()

  if (!invoiceId) {
    return NextResponse.json({
      configured: financingConfigured(),
      provider: financingProvider(),
      checklist: checklist.steps
    })
  }

  if (!financingConfigured()) {
    return NextResponse.json({ error: 'Customer financing is not configured. Set WISETACK_PARTNER_ID, AFFIRM_PUBLIC_API_KEY, or FINANCING_WEBHOOK_URL.' }, { status: 503 })
  }

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const invoiceRow = rows.find(r => r.kind === 'invoices' && JSON.parse(r.data).id === invoiceId)
  if (!invoiceRow) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  const invoice = JSON.parse(invoiceRow.data) as Record<string, unknown>
  const amount = Number(invoice.balance || invoice.total || 0)
  if (amount < 300) return NextResponse.json({ error: 'Financing requires a minimum invoice of $300.' }, { status: 400 })

  const shop = (rows.filter(r => r.kind === 'shops').map(r => JSON.parse(r.data) as Record<string, unknown>))[0]
  const offer = buildFinancingOffer(amount, String(shop?.name || 'AutoGaragify'), invoiceId)
  return NextResponse.json({ ok: true, offer, amount })
}

const referSchema = z.object({
  invoiceId: z.string().min(1)
})

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: `${user.role} access cannot send financing referrals.` }, { status: 403 })
  }

  const parsed = referSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 })

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const invoiceRow = rows.find(r => r.kind === 'invoices' && JSON.parse(r.data).id === parsed.data.invoiceId)
  if (!invoiceRow) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  const invoice = JSON.parse(invoiceRow.data) as Record<string, unknown>
  const customerRow = rows.find(r => r.kind === 'customers' && JSON.parse(r.data).id === invoice.customerId)
  const customer = customerRow ? JSON.parse(customerRow.data) as Record<string, unknown> : {}
  const shop = (rows.filter(r => r.kind === 'shops').map(r => JSON.parse(r.data) as Record<string, unknown>))[0]
  const amount = Number(invoice.balance || invoice.total || 0)

  const result = await pushFinancingReferral({
    shopId: user.shopId,
    shopName: String(shop?.name || 'AutoGaragify'),
    invoiceId: parsed.data.invoiceId,
    customerName: String(customer.name || ''),
    customerEmail: String(customer.email || ''),
    amount
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, message: 'Financing referral sent to provider.' })
}
