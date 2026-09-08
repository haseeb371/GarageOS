import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { retrieveCheckoutSession, appBaseUrl } from '@/lib/stripe'
import { buildAutomationContext, planAutomationsForSave } from '@/lib/automationRuntime'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id') || ''
  const base = appBaseUrl()
  if (!sessionId) {
    return NextResponse.redirect(`${base}/?section=invoices&payment=missing`)
  }

  const retrieved = await retrieveCheckoutSession(sessionId)
  if (!retrieved.ok || !retrieved.session) {
    return NextResponse.redirect(`${base}/?section=invoices&payment=error`)
  }

  const session = retrieved.session
  if (session.payment_status !== 'paid') {
    return NextResponse.redirect(`${base}/?section=invoices&payment=unpaid`)
  }

  const invoiceId = session.metadata?.invoiceId || session.client_reference_id || ''
  if (!invoiceId) {
    return NextResponse.redirect(`${base}/?section=invoices&payment=error`)
  }

  const amount = Number(session.amount_total || 0) / 100
  const now = Date.now()
  const paymentId = `P-STRIPE-${String(session.id || now).slice(-10)}`

  try {
    await db.transaction(async tx => {
      const invoiceRows = await tx.select().from(records).where(and(eq(records.id, invoiceId), eq(records.kind, 'invoices')))
      const invoiceRow = invoiceRows[0]
      if (!invoiceRow) throw new Error('Invoice not found')
      const invoice = JSON.parse(invoiceRow.data) as Row
      const shopId = invoiceRow.shopId

      const existingPayments = await tx.select().from(records).where(and(eq(records.shopId, shopId), eq(records.kind, 'payments')))
      const already = existingPayments.some(row => {
        const payment = JSON.parse(row.data) as Row
        return payment.reference === session.id || payment.id === paymentId
      })
      if (already) return

      const balance = Math.max(0, Number(invoice.balance || 0) - amount)
      const updatedInvoice = {
        ...invoice,
        balance,
        status: balance === 0 ? 'Paid' : 'Partial',
        shopId
      }
      await tx.update(records).set({ data: JSON.stringify(updatedInvoice), updatedAt: now }).where(and(eq(records.id, invoiceId), eq(records.shopId, shopId)))

      const payment = {
        id: paymentId,
        invoiceId,
        customerId: String(invoice.customerId || ''),
        amount,
        method: 'Stripe card',
        status: 'Captured',
        date: new Date().toISOString().slice(0, 10),
        reference: session.id || session.payment_intent || '',
        shopId
      }
      await tx.insert(records).values({
        id: paymentId,
        kind: 'payments',
        shopId,
        data: JSON.stringify(payment),
        createdAt: now,
        updatedAt: now
      }).onConflictDoNothing()

      const shopRows = await tx.select().from(records).where(eq(records.shopId, shopId))
      const refreshed = shopRows.map(row => ({ kind: row.kind, data: JSON.parse(row.data) as Row }))
      const automations = refreshed.filter(row => row.kind === 'workflowAutomations').map(row => row.data)
      const baseContext = buildAutomationContext(refreshed, null)

      const paymentEffects = planAutomationsForSave('payments', payment, automations, baseContext)
      const invoiceEffects =
        String(updatedInvoice.status) === 'Paid'
          ? planAutomationsForSave('invoices', updatedInvoice, automations, {
              ...buildAutomationContext(refreshed, invoice),
              automationJobs: [
                ...(baseContext.automationJobs || []),
                ...paymentEffects.filter(e => e.kind === 'automationJobs').map(e => e.record)
              ]
            })
          : []

      for (const effect of [...paymentEffects, ...invoiceEffects]) {
        const clean = { ...effect.record, shopId }
        await tx.insert(records).values({
          id: effect.record.id,
          kind: effect.kind,
          shopId,
          data: JSON.stringify(clean),
          createdAt: now,
          updatedAt: now
        }).onConflictDoUpdate({
          target: records.id,
          set: { data: JSON.stringify(clean), kind: effect.kind, shopId, updatedAt: now }
        })
      }
    })
  } catch {
    return NextResponse.redirect(`${base}/?section=invoices&payment=error`)
  }

  return NextResponse.redirect(`${base}/?section=invoices&payment=success`)
}
