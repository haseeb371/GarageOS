import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePortalCheckoutInvoice } from '@/lib/customerPortal'
import { createCheckoutSession } from '@/lib/stripe'

const payload = z.object({
  invoiceId: z.string().min(1).optional()
})

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Missing portal token.' }, { status: 400 })
  }
  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid checkout request.' }, { status: 400 })
  }

  try {
    const resolved = await resolvePortalCheckoutInvoice(token, parsed.data.invoiceId)
    const result = await createCheckoutSession({
      invoiceId: resolved.invoice.id,
      amount: resolved.invoice.balance,
      currency: resolved.currency,
      customerEmail: resolved.customerEmail,
      customerName: resolved.customerName,
      description: `Invoice ${resolved.invoice.id} · ${resolved.shopName}`,
      successUrl: `${new URL(req.url).origin}/portal/${token}?paid=1`,
      cancelUrl: `${new URL(req.url).origin}/portal/${token}?payment=cancelled`,
      portalToken: token
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.sandbox ? 503 : 400 })
    }
    return NextResponse.json({ ok: true, url: result.url, sessionId: result.id })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not start checkout.' },
      { status: 400 }
    )
  }
}
