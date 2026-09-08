import { NextResponse } from 'next/server'
import { stripeConfigured, stripeMode } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = stripeConfigured()
  const mode = stripeMode()
  return NextResponse.json({
    configured,
    provider: 'Stripe',
    mode,
    message: configured
      ? `Stripe Checkout is ready (${mode} mode). Use Pay with card on an open invoice.`
      : 'Add STRIPE_SECRET_KEY to .env.local (use sk_test_… for safe testing), then restart AutoGaragify.'
  })
}
