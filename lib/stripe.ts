export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

export function stripeMode() {
  const key = String(process.env.STRIPE_SECRET_KEY || '')
  if (!key) return 'unset'
  return key.startsWith('sk_live') ? 'live' : 'test'
}

export function appBaseUrl() {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

type CheckoutInput = {
  invoiceId: string
  amount: number
  currency: string
  customerEmail?: string
  customerName?: string
  description: string
}

export async function createCheckoutSession(input: CheckoutInput) {
  if (!stripeConfigured()) {
    return {
      ok: false as const,
      sandbox: true as const,
      error: 'Add STRIPE_SECRET_KEY to .env.local, then restart AutoGaragify.'
    }
  }

  const amount = Math.round(Number(input.amount) * 100)
  if (!Number.isFinite(amount) || amount < 50) {
    return { ok: false as const, sandbox: false as const, error: 'Stripe requires a minimum charge of about 0.50 in the shop currency.' }
  }

  const currency = String(input.currency || 'usd').toLowerCase()
  const base = appBaseUrl()
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  body.set('success_url', `${base}/api/payments/complete?session_id={CHECKOUT_SESSION_ID}`)
  body.set('cancel_url', `${base}/?section=invoices&payment=cancelled`)
  body.set('client_reference_id', input.invoiceId)
  body.set('metadata[invoiceId]', input.invoiceId)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', currency)
  body.set('line_items[0][price_data][unit_amount]', String(amount))
  body.set('line_items[0][price_data][product_data][name]', input.description)
  if (input.customerEmail) body.set('customer_email', input.customerEmail)

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  const result = (await response.json().catch(() => ({}))) as {
    id?: string
    url?: string
    error?: { message?: string }
  }

  if (!response.ok || !result.url) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: result.error?.message || `Stripe returned ${response.status}.`
    }
  }

  return { ok: true as const, sandbox: false as const, id: result.id || '', url: result.url }
}

export async function retrieveCheckoutSession(sessionId: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: 'Stripe is not configured.' }
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  })
  const result = (await response.json().catch(() => ({}))) as {
    id?: string
    payment_status?: string
    amount_total?: number
    currency?: string
    client_reference_id?: string
    payment_intent?: string
    metadata?: { invoiceId?: string }
    error?: { message?: string }
  }

  if (!response.ok) {
    return { ok: false as const, error: result.error?.message || `Stripe returned ${response.status}.` }
  }

  return { ok: true as const, session: result }
}

export function terminalConfigured() {
  return Boolean(stripeConfigured() && process.env.STRIPE_TERMINAL_LOCATION_ID?.trim())
}

export async function createTerminalConnectionToken() {
  if (!stripeConfigured()) {
    return { ok: false as const, sandbox: true as const, error: 'Add STRIPE_SECRET_KEY to enable card-present payments.' }
  }
  const response = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  })
  const result = (await response.json().catch(() => ({}))) as { secret?: string; error?: { message?: string } }
  if (!response.ok || !result.secret) {
    return { ok: false as const, sandbox: false as const, error: result.error?.message || `Stripe Terminal returned ${response.status}.` }
  }
  return { ok: true as const, sandbox: false as const, secret: result.secret }
}

export async function createTerminalPaymentIntent(amount: number, currency: string, invoiceId: string, description: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, sandbox: true as const, error: 'Add STRIPE_SECRET_KEY to enable card-present payments.' }
  }
  const cents = Math.round(Number(amount) * 100)
  if (!Number.isFinite(cents) || cents < 50) {
    return { ok: false as const, sandbox: false as const, error: 'Minimum card-present charge is $0.50.' }
  }
  const body = new URLSearchParams()
  body.set('amount', String(cents))
  body.set('currency', String(currency || 'usd').toLowerCase())
  body.set('description', description)
  body.set('payment_method_types[]', 'card_present')
  body.set('capture_method', 'automatic')
  body.set('metadata[invoiceId]', invoiceId)
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const result = (await response.json().catch(() => ({}))) as { id?: string; client_secret?: string; error?: { message?: string } }
  if (!response.ok || !result.id) {
    return { ok: false as const, sandbox: false as const, error: result.error?.message || `Stripe returned ${response.status}.` }
  }
  return { ok: true as const, sandbox: false as const, id: result.id, clientSecret: result.client_secret || '' }
}

export async function captureTerminalPayment(paymentIntentId: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: 'Stripe is not configured.' }
  }
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  })
  const result = (await response.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } }
  if (!response.ok) {
    return { ok: false as const, error: result.error?.message || `Capture failed (${response.status}).` }
  }
  return { ok: true as const, status: result.status, id: result.id }
}
