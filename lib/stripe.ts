export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

export function stripeMode() {
  const key = String(process.env.STRIPE_SECRET_KEY || '')
  if (!key) return 'unset'
  return key.startsWith('sk_live') ? 'live' : 'test'
}

export function appBaseUrl() {
  const explicit = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim()
  if (explicit) return explicit.replace(/\/$/, '')

  // Vercel sets these automatically; prefer the stable production host when present.
  const productionHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim()
  if (productionHost) return `https://${productionHost.replace(/^https?:\/\//, '')}`.replace(/\/$/, '')

  const previewHost = (process.env.VERCEL_URL || '').trim()
  if (previewHost) return `https://${previewHost.replace(/^https?:\/\//, '')}`.replace(/\/$/, '')

  return 'http://localhost:3000'
}

type CheckoutInput = {
  invoiceId: string
  amount: number
  currency: string
  customerEmail?: string
  customerName?: string
  description: string
  successUrl?: string
  cancelUrl?: string
  portalToken?: string
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
  const completeBase = `${base}/api/payments/complete?session_id={CHECKOUT_SESSION_ID}`
  const successUrl = input.portalToken
    ? `${completeBase}&portal=${encodeURIComponent(input.portalToken)}`
    : input.successUrl || completeBase
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  body.set('success_url', successUrl)
  body.set('cancel_url', input.cancelUrl || `${base}/?section=invoices&payment=cancelled`)
  body.set('client_reference_id', input.invoiceId)
  body.set('metadata[invoiceId]', input.invoiceId)
  if (input.portalToken) body.set('metadata[portalToken]', input.portalToken)
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
  // Location helps discover physical readers; simulated counter pay only needs the secret key.
  return stripeConfigured()
}

export function terminalLocationConfigured() {
  return Boolean(process.env.STRIPE_TERMINAL_LOCATION_ID?.trim())
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
  const location = process.env.STRIPE_TERMINAL_LOCATION_ID?.trim()
  if (location) body.set('metadata[locationId]', location)
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

/** Test-mode counter collect without a physical reader (uses card PaymentIntent + test PM). */
export async function simulateCounterPayment(amount: number, currency: string, invoiceId: string, description: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, sandbox: true as const, error: 'Add STRIPE_SECRET_KEY to enable counter payments.' }
  }
  const key = String(process.env.STRIPE_SECRET_KEY || '')
  if (!key.startsWith('sk_test')) {
    return {
      ok: false as const,
      sandbox: false as const,
      error: 'Simulated counter pay only works with Stripe test keys (sk_test_…). Use a Terminal reader for live.'
    }
  }
  const cents = Math.round(Number(amount) * 100)
  if (!Number.isFinite(cents) || cents < 50) {
    return { ok: false as const, sandbox: false as const, error: 'Minimum charge is $0.50.' }
  }
  const body = new URLSearchParams()
  body.set('amount', String(cents))
  body.set('currency', String(currency || 'usd').toLowerCase())
  body.set('description', description)
  body.set('payment_method', 'pm_card_visa')
  body.set('confirm', 'true')
  body.set('metadata[invoiceId]', invoiceId)
  body.set('metadata[channel]', 'terminal_simulated')
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const result = (await response.json().catch(() => ({}))) as {
    id?: string
    status?: string
    amount?: number
    error?: { message?: string }
  }
  if (!response.ok || result.status !== 'succeeded') {
    return {
      ok: false as const,
      sandbox: false as const,
      error: result.error?.message || `Simulated counter pay failed (${response.status}).`
    }
  }
  return {
    ok: true as const,
    sandbox: false as const,
    id: result.id || '',
    status: result.status || 'succeeded',
    amount: Number(result.amount || cents) / 100
  }
}

export async function captureTerminalPayment(paymentIntentId: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: 'Stripe is not configured.' }
  }
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  })
  const result = (await response.json().catch(() => ({}))) as {
    id?: string
    status?: string
    amount_received?: number
    amount?: number
    metadata?: { invoiceId?: string }
    error?: { message?: string }
  }
  if (!response.ok) {
    return { ok: false as const, error: result.error?.message || `Capture failed (${response.status}).` }
  }
  return {
    ok: true as const,
    status: result.status,
    id: result.id,
    amount: Number(result.amount_received || result.amount || 0) / 100,
    invoiceId: result.metadata?.invoiceId || ''
  }
}

export async function retrievePaymentIntent(paymentIntentId: string) {
  if (!stripeConfigured()) {
    return { ok: false as const, error: 'Stripe is not configured.' }
  }
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  })
  const result = (await response.json().catch(() => ({}))) as {
    id?: string
    status?: string
    amount_received?: number
    amount?: number
    metadata?: { invoiceId?: string }
    error?: { message?: string }
  }
  if (!response.ok) {
    return { ok: false as const, error: result.error?.message || `Retrieve failed (${response.status}).` }
  }
  return {
    ok: true as const,
    id: result.id || '',
    status: result.status || '',
    amount: Number(result.amount_received || result.amount || 0) / 100,
    invoiceId: result.metadata?.invoiceId || ''
  }
}
