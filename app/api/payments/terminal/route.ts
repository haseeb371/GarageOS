import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import {
  captureTerminalPayment,
  createTerminalConnectionToken,
  createTerminalPaymentIntent,
  retrievePaymentIntent,
  simulateCounterPayment,
  stripeMode,
  terminalConfigured,
  terminalLocationConfigured
} from '@/lib/stripe'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

async function applyInvoicePayment(input: {
  shopId: string
  invoiceId: string
  amount: number
  reference: string
  method: string
}) {
  const now = Date.now()
  const paymentId = `P-TERM-${String(input.reference || now).slice(-10)}`
  await db.transaction(async tx => {
    const [invoiceRow] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, input.invoiceId), eq(records.kind, 'invoices'), eq(records.shopId, input.shopId)))
      .limit(1)
    if (!invoiceRow) throw new Error('Invoice not found.')
    const invoice = JSON.parse(invoiceRow.data) as Row

    const existing = await tx
      .select()
      .from(records)
      .where(and(eq(records.shopId, input.shopId), eq(records.kind, 'payments')))
    const already = existing.some(row => {
      const payment = JSON.parse(row.data) as Row
      return payment.reference === input.reference || payment.id === paymentId
    })
    if (already) return

    const balance = Math.max(0, Number(invoice.balance || 0) - input.amount)
    const updated = { ...invoice, balance, status: balance === 0 ? 'Paid' : 'Partial', shopId: input.shopId }
    await tx
      .update(records)
      .set({ data: JSON.stringify(updated), updatedAt: now })
      .where(and(eq(records.id, input.invoiceId), eq(records.shopId, input.shopId)))

    await tx.insert(records).values({
      id: paymentId,
      kind: 'payments',
      shopId: input.shopId,
      data: JSON.stringify({
        id: paymentId,
        invoiceId: input.invoiceId,
        customerId: String(invoice.customerId || ''),
        amount: input.amount,
        method: input.method,
        status: 'Captured',
        date: new Date().toISOString().slice(0, 10),
        reference: input.reference,
        shopId: input.shopId
      }),
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing()
  })
  return { paymentId }
}

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const configured = terminalConfigured()
  return NextResponse.json({
    configured,
    locationConfigured: terminalLocationConfigured(),
    provider: 'Stripe Terminal',
    mode: stripeMode(),
    simulateAvailable: stripeMode() === 'test',
    message: configured
      ? stripeMode() === 'test'
        ? 'Counter pay ready — use simulated collect in test mode, or a Terminal reader when location is set.'
        : 'Card-present payments are ready. Connect a Stripe Terminal reader at the counter.'
      : 'Add STRIPE_SECRET_KEY to enable counter / Terminal payments.'
  })
}

const actionSchema = z.object({
  action: z.enum(['connection-token', 'create-intent', 'capture', 'simulate-collect', 'complete']),
  amount: z.number().optional(),
  currency: z.string().optional(),
  invoiceId: z.string().optional(),
  description: z.string().optional(),
  paymentIntentId: z.string().optional()
})

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor', 'Bookkeeper'].includes(user.role)) {
    return NextResponse.json({ error: `${user.role} access cannot process card payments.` }, { status: 403 })
  }

  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 })
  }

  if (parsed.data.action === 'connection-token') {
    const result = await createTerminalConnectionToken()
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    return NextResponse.json({ ok: true, secret: result.secret })
  }

  if (parsed.data.action === 'create-intent') {
    if (!parsed.data.amount || !parsed.data.invoiceId) {
      return NextResponse.json({ error: 'Amount and invoiceId are required.' }, { status: 400 })
    }
    const result = await createTerminalPaymentIntent(
      parsed.data.amount,
      parsed.data.currency || 'usd',
      parsed.data.invoiceId,
      parsed.data.description || `Invoice ${parsed.data.invoiceId}`
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    return NextResponse.json({ ok: true, id: result.id, clientSecret: result.clientSecret })
  }

  if (parsed.data.action === 'simulate-collect') {
    if (!parsed.data.amount || !parsed.data.invoiceId) {
      return NextResponse.json({ error: 'Amount and invoiceId are required.' }, { status: 400 })
    }
    const result = await simulateCounterPayment(
      parsed.data.amount,
      parsed.data.currency || 'usd',
      parsed.data.invoiceId,
      parsed.data.description || `Invoice ${parsed.data.invoiceId}`
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    try {
      await applyInvoicePayment({
        shopId: user.shopId,
        invoiceId: parsed.data.invoiceId,
        amount: result.amount,
        reference: result.id,
        method: 'Stripe Terminal (simulated)'
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Payment collected but ledger update failed.' },
        { status: 400 }
      )
    }
    return NextResponse.json({
      ok: true,
      id: result.id,
      status: result.status,
      amount: result.amount,
      message: `Collected ${result.amount.toFixed(2)} at the counter (simulated).`
    })
  }

  if (parsed.data.action === 'capture' || parsed.data.action === 'complete') {
    if (!parsed.data.paymentIntentId) {
      return NextResponse.json({ error: 'paymentIntentId is required.' }, { status: 400 })
    }
    const retrieved =
      parsed.data.action === 'capture'
        ? await captureTerminalPayment(parsed.data.paymentIntentId)
        : await retrievePaymentIntent(parsed.data.paymentIntentId)
    if (!retrieved.ok) return NextResponse.json({ error: retrieved.error }, { status: 400 })
    const invoiceId = parsed.data.invoiceId || retrieved.invoiceId
    if (!invoiceId) return NextResponse.json({ error: 'Invoice id missing on payment.' }, { status: 400 })
    if (retrieved.status && !['succeeded', 'requires_capture'].includes(retrieved.status) && parsed.data.action === 'complete') {
      return NextResponse.json({ error: `Payment status is ${retrieved.status}.` }, { status: 400 })
    }
    const amount = retrieved.amount || parsed.data.amount || 0
    if (amount <= 0) return NextResponse.json({ error: 'Payment amount missing.' }, { status: 400 })
    try {
      await applyInvoicePayment({
        shopId: user.shopId,
        invoiceId,
        amount,
        reference: retrieved.id || parsed.data.paymentIntentId,
        method: 'Stripe Terminal'
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not apply payment to invoice.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ ok: true, status: retrieved.status, id: retrieved.id, amount })
  }

  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
}
