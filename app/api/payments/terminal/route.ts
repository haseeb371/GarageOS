import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { createTerminalConnectionToken, createTerminalPaymentIntent, captureTerminalPayment, terminalConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const configured = terminalConfigured()
  return NextResponse.json({
    configured,
    provider: 'Stripe Terminal',
    mode: configured ? 'ready' : 'setup needed',
    message: configured
      ? 'Card-present payments are ready. Connect a Stripe Terminal reader at the counter.'
      : 'Add STRIPE_SECRET_KEY and STRIPE_TERMINAL_LOCATION_ID to .env.local to enable card-present payments.'
  })
}

const actionSchema = z.object({
  action: z.enum(['connection-token', 'create-intent', 'capture']),
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
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 })

  if (parsed.data.action === 'connection-token') {
    const result = await createTerminalConnectionToken()
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    return NextResponse.json({ ok: true, secret: result.secret })
  }

  if (parsed.data.action === 'create-intent') {
    if (!parsed.data.amount || !parsed.data.invoiceId) return NextResponse.json({ error: 'Amount and invoiceId are required.' }, { status: 400 })
    const result = await createTerminalPaymentIntent(
      parsed.data.amount,
      parsed.data.currency || 'usd',
      parsed.data.invoiceId,
      parsed.data.description || `Invoice ${parsed.data.invoiceId}`
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    return NextResponse.json({ ok: true, id: result.id, clientSecret: result.clientSecret })
  }

  if (parsed.data.action === 'capture') {
    if (!parsed.data.paymentIntentId) return NextResponse.json({ error: 'paymentIntentId is required.' }, { status: 400 })
    const result = await captureTerminalPayment(parsed.data.paymentIntentId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, status: result.status, id: result.id })
  }

  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
}
