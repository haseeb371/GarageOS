'use client'

import { useEffect, useState } from 'react'
import { BadgeDollarSign, Check, Clock3, CreditCard, ShieldCheck, Wrench, X } from 'lucide-react'

type Invoice = { id: string; orderId: string; status: string; total: number; balance: number; date: string }
type Job = { id: string; name: string; decision: string; severity: string }
type FinancingOffer = {
  provider: string
  applyUrl: string
  monthlyEstimate: string
  aprRange: string
  terms: string[]
  sandbox?: boolean
}
type Portal = {
  state: 'open' | 'expired' | 'invalid'
  expiresAt?: number
  shop?: { name: string; phone: string; address: string; currency: string }
  customer?: { name: string }
  vehicle?: { year: number; make: string; model: string; plate: string } | null
  order?: {
    id: string
    status: string
    statusLabel: string
    statusDetail: string
    jobs: Job[]
  }
  invoices?: Invoice[]
  balanceDue?: number
  canPay?: boolean
  financing?: FinancingOffer | null
  error?: string
}

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value || 0)

export default function CustomerPortal({ token }: { token: string }) {
  const [portal, setPortal] = useState<Portal | null>(null)
  const [error, setError] = useState('')
  const [payingId, setPayingId] = useState('')
  const [banner, setBanner] = useState('')

  const load = () =>
    fetch(`/api/portal/${token}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json()
        if (!response.ok && !body.state) throw new Error(body.error || 'Could not open portal.')
        setPortal(body)
      })
      .catch(e => setError(e.message))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('paid') === '1') setBanner('Payment received. Thank you — your balance is updating.')
    if (params.get('payment') === 'cancelled') setBanner('Checkout was cancelled. You can try again anytime.')
    load()
  }, [token])

  const pay = async (invoiceId: string) => {
    setPayingId(invoiceId)
    setError('')
    try {
      const response = await fetch(`/api/portal/${token}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not start checkout.')
      if (!body.url) throw new Error('Stripe did not return a checkout URL.')
      window.location.href = body.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout.')
      setPayingId('')
    }
  }

  if (error && !portal) {
    return (
      <main className="estimate-public">
        <section className="estimate-message">
          <X />
          <h1>We couldn’t open this page</h1>
          <p>{error}</p>
        </section>
      </main>
    )
  }

  if (!portal) {
    return (
      <main className="estimate-public">
        <section className="estimate-message">
          <div className="estimate-spinner" />
          <h1>Opening your visit…</h1>
        </section>
      </main>
    )
  }

  if (portal.state === 'invalid' || portal.state === 'expired') {
    return (
      <main className="estimate-public">
        <section className="estimate-message">
          <Clock3 />
          <h1>{portal.state === 'expired' ? 'This link has expired' : 'This link is not valid'}</h1>
          <p>Contact the repair shop and ask for a new secure status link.</p>
        </section>
      </main>
    )
  }

  const currency = portal.shop?.currency || 'USD'
  const vehicleLabel = portal.vehicle
    ? `${portal.vehicle.year} ${portal.vehicle.make} ${portal.vehicle.model}${portal.vehicle.plate ? ` · ${portal.vehicle.plate}` : ''}`
    : 'Vehicle'
  const financing = portal.financing

  return (
    <main className="estimate-public portal-public">
      <header className="estimate-header">
        <div className="estimate-logo">G</div>
        <div>
          <b>{portal.shop?.name}</b>
          <span>
            {portal.shop?.phone}
            {portal.shop?.address ? ` · ${portal.shop.address}` : ''}
          </span>
        </div>
        <ShieldCheck />
      </header>

      <div className="estimate-wrap">
        {banner && <p className="portal-banner">{banner}</p>}

        <section className="estimate-hero">
          <small>CUSTOMER PORTAL</small>
          <h1>Hi {portal.customer?.name}, here’s your visit status.</h1>
          <p>
            {vehicleLabel} · Repair order {portal.order?.id}
          </p>
        </section>

        <div className="estimate-layout">
          <section className="portal-main">
            <article className="portal-status card-plain">
              <small>STATUS</small>
              <h2>{portal.order?.statusLabel}</h2>
              <p>{portal.order?.statusDetail}</p>
              <span className={`portal-status-pill lane-${String(portal.order?.status || '').toLowerCase().replaceAll(' ', '-')}`}>
                {portal.order?.status}
              </span>
            </article>

            <div className="portal-jobs">
              <h2>Services on this visit</h2>
              {(portal.order?.jobs || []).length === 0 && (
                <p className="muted">No service lines listed yet.</p>
              )}
              {(portal.order?.jobs || []).map(job => (
                <article className="estimate-job" key={job.id}>
                  <div className="estimate-job-main">
                    <div className="estimate-tool">
                      <Wrench />
                    </div>
                    <div>
                      <span className={`estimate-severity ${job.severity?.toLowerCase().replaceAll(' ', '-')}`}>
                        {job.severity}
                      </span>
                      <h3>{job.name}</h3>
                      <p>Decision: {job.decision}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="estimate-summary">
            <small>BALANCE DUE</small>
            <strong>{money(portal.balanceDue || 0, currency)}</strong>
            <p>
              {portal.canPay
                ? 'Pay securely with card. You’ll return here after checkout.'
                : 'No open balance on this visit right now.'}
            </p>

            {(portal.invoices || []).map(inv => (
              <div className="portal-invoice" key={inv.id}>
                <div>
                  <b>{inv.id}</b>
                  <span>
                    {money(inv.balance, currency)} due
                    {inv.date ? ` · ${inv.date}` : ''}
                  </span>
                </div>
                <button
                  className="estimate-submit portal-pay"
                  disabled={!!payingId}
                  onClick={() => pay(inv.id)}
                >
                  {payingId === inv.id ? 'Starting…' : 'Pay now'} <CreditCard size={16} />
                </button>
              </div>
            ))}

            {financing && (portal.balanceDue || 0) >= 300 && (
              <div className="portal-invoice">
                <div>
                  <b>{financing.provider}</b>
                  <span>
                    {financing.monthlyEstimate} · {financing.aprRange}
                  </span>
                </div>
                <a className="estimate-submit portal-pay" href={financing.applyUrl} target="_blank" rel="noreferrer">
                  Finance this visit <BadgeDollarSign size={16} />
                </a>
              </div>
            )}

            {!portal.canPay && (
              <div className="estimate-secure">
                <Check /> You’re all set on payments for this link.
              </div>
            )}

            {error && <p className="estimate-error">{error}</p>}

            <div className="estimate-secure">
              <ShieldCheck /> Secure, expiring link · card payments via Stripe
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
