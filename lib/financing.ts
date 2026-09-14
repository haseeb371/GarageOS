export function financingConfigured() {
  return (
    Boolean(
      process.env.WISETACK_PARTNER_ID?.trim() ||
        process.env.AFFIRM_PUBLIC_API_KEY?.trim() ||
        process.env.FINANCING_WEBHOOK_URL?.trim()
    ) || financingSandboxEnabled()
  )
}

export function financingSandboxEnabled() {
  const raw = String(process.env.FINANCING_MODE || 'sandbox').trim().toLowerCase()
  if (raw === 'off' || raw === 'disabled') return false
  // Default on so shops can demo without partner keys.
  if (process.env.WISETACK_PARTNER_ID?.trim() || process.env.AFFIRM_PUBLIC_API_KEY?.trim()) return false
  return raw === 'sandbox' || raw === '' || raw === 'auto'
}

export function financingProvider(): 'wisetack' | 'affirm' | 'webhook' | 'sandbox' | 'none' {
  if (process.env.WISETACK_PARTNER_ID?.trim()) return 'wisetack'
  if (process.env.AFFIRM_PUBLIC_API_KEY?.trim()) return 'affirm'
  if (process.env.FINANCING_WEBHOOK_URL?.trim()) return 'webhook'
  if (financingSandboxEnabled()) return 'sandbox'
  return 'none'
}

export function financingSetupChecklist() {
  const provider = financingProvider()
  const steps: Array<{ id: string; label: string; done: boolean; detail: string }> = []

  steps.push({
    id: 'provider',
    label: 'Financing provider selected',
    done: provider !== 'none',
    detail:
      provider === 'wisetack'
        ? 'Wisetack configured'
        : provider === 'affirm'
          ? 'Affirm configured'
          : provider === 'webhook'
            ? 'Webhook configured'
            : provider === 'sandbox'
              ? 'Sandbox demo financing enabled'
              : 'Set WISETACK_PARTNER_ID, AFFIRM_PUBLIC_API_KEY, FINANCING_WEBHOOK_URL, or FINANCING_MODE=sandbox'
  })

  if (provider === 'wisetack') {
    steps.push({
      id: 'partner-id',
      label: 'Wisetack Partner ID',
      done: Boolean(process.env.WISETACK_PARTNER_ID?.trim()),
      detail: 'Apply at https://www.wisetack.com/partners → get Partner ID → set WISETACK_PARTNER_ID'
    })
  }

  if (provider === 'affirm') {
    steps.push({
      id: 'api-key',
      label: 'Affirm API key',
      done: Boolean(process.env.AFFIRM_PUBLIC_API_KEY?.trim()),
      detail: 'Apply at https://www.affirm.com/business → get API keys → set AFFIRM_PUBLIC_API_KEY and AFFIRM_SECRET_API_KEY'
    })
  }

  return { provider, configured: financingConfigured(), steps }
}

export type FinancingOffer = {
  provider: string
  applyUrl: string
  monthlyEstimate: string
  aprRange: string
  terms: string[]
  sandbox?: boolean
}

export function buildFinancingOffer(
  amount: number,
  shopName: string,
  invoiceId: string,
  opts?: { baseUrl?: string; orderId?: string }
): FinancingOffer | null {
  const provider = financingProvider()
  if (provider === 'none' || amount < 300) return null

  const monthly = Math.max(25, Math.round(amount / 12))
  const partnerId = process.env.WISETACK_PARTNER_ID || ''
  const affirmKey = process.env.AFFIRM_PUBLIC_API_KEY || ''
  const base = (opts?.baseUrl || process.env.APP_URL || 'https://autogaragify.com').replace(/\/$/, '')

  if (provider === 'wisetack') {
    return {
      provider: 'Wisetack',
      applyUrl: `https://www.wisetack.com/apply?partner=${encodeURIComponent(partnerId)}&amount=${amount}&ref=${encodeURIComponent(invoiceId)}`,
      monthlyEstimate: `~$${monthly}/mo`,
      aprRange: '0-36% APR',
      terms: ['3, 6, 12, 24, 36, 60 month plans', 'Soft credit check', 'No prepayment penalty']
    }
  }

  if (provider === 'affirm') {
    return {
      provider: 'Affirm',
      applyUrl: `https://www.affirm.com/make-a-payment?public_api_key=${encodeURIComponent(affirmKey)}&amount=${amount}&ref=${encodeURIComponent(invoiceId)}`,
      monthlyEstimate: `~$${monthly}/mo`,
      aprRange: '0-30% APR',
      terms: ['3, 6, 12 month plans', 'Pay in 4 available', 'No late fees']
    }
  }

  if (provider === 'webhook') {
    return {
      provider: 'Webhook',
      applyUrl: `${process.env.FINANCING_WEBHOOK_URL}?amount=${amount}&invoice=${encodeURIComponent(invoiceId)}&shop=${encodeURIComponent(shopName)}`,
      monthlyEstimate: `~$${monthly}/mo`,
      aprRange: 'Varies by provider',
      terms: ['Custom financing partner', 'Webhook integration']
    }
  }

  const params = new URLSearchParams({
    amount: String(amount),
    invoice: invoiceId || '',
    order: opts?.orderId || '',
    shop: shopName
  })
  return {
    provider: 'Sandbox financing',
    applyUrl: `${base}/financing/demo?${params.toString()}`,
    monthlyEstimate: `~$${monthly}/mo`,
    aprRange: 'Demo 0–29.9% APR',
    terms: ['Sandbox only — not a real lender', 'Shows monthly estimate to customers', 'Swap in Wisetack/Affirm when approved'],
    sandbox: true
  }
}

export async function pushFinancingReferral(input: {
  shopId: string
  shopName: string
  invoiceId: string
  customerName: string
  customerEmail: string
  amount: number
}) {
  const url = process.env.FINANCING_WEBHOOK_URL?.trim()
  if (!url) {
    if (financingSandboxEnabled()) {
      return { ok: true as const, sandbox: true as const, message: 'Sandbox financing interest recorded locally.' }
    }
    return { ok: false as const, error: 'No financing webhook configured.' }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'AutoGaragify',
        shopId: input.shopId,
        shopName: input.shopName,
        invoiceId: input.invoiceId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        amount: input.amount,
        generatedAt: new Date().toISOString()
      })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {
        ok: false as const,
        error: `Financing webhook returned ${response.status}${text ? `: ${text.slice(0, 120)}` : '.'}`
      }
    }
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not reach financing webhook.' }
  }
}
