'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { BadgeDollarSign, Check, ShieldCheck } from 'lucide-react'

const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0)

export default function FinancingDemoPage() {
  const params = useSearchParams()
  const amount = Number(params.get('amount') || 0)
  const invoice = params.get('invoice') || ''
  const order = params.get('order') || ''
  const shop = params.get('shop') || 'Your repair shop'
  const monthly = Math.max(25, Math.round(amount / 12))

  const plans = useMemo(
    () => [
      { months: 6, payment: Math.max(25, Math.round(amount / 6)), apr: '0–9.9%' },
      { months: 12, payment: monthly, apr: '0–19.9%' },
      { months: 24, payment: Math.max(25, Math.round(amount / 24)), apr: '9.9–29.9%' }
    ],
    [amount, monthly]
  )

  return (
    <main className="estimate-public">
      <header className="estimate-header">
        <div className="estimate-logo">G</div>
        <div>
          <b>{shop}</b>
          <span>Sandbox financing preview · not a real lender</span>
        </div>
        <ShieldCheck />
      </header>
      <div className="estimate-wrap">
        <section className="estimate-hero">
          <small>FINANCING DEMO</small>
          <h1>See monthly options for {money(amount)}.</h1>
          <p>
            {invoice ? `Invoice ${invoice}` : order ? `Repair order ${order}` : 'Estimate'} · This page is for demos only.
            Connect Wisetack or Affirm when you have partner credentials.
          </p>
        </section>
        <div className="estimate-layout">
          <section>
            <h2>Sample plans</h2>
            {plans.map(plan => (
              <article className="estimate-job" key={plan.months}>
                <div className="estimate-job-main">
                  <div className="estimate-tool">
                    <BadgeDollarSign />
                  </div>
                  <div>
                    <h3>{plan.months}-month plan</h3>
                    <p>APR range {plan.apr} · soft credit check (demo)</p>
                  </div>
                  <b>{money(plan.payment)}/mo</b>
                </div>
              </article>
            ))}
          </section>
          <aside className="estimate-summary">
            <small>DEMO APPLICATION</small>
            <strong>{money(monthly)}/mo</strong>
            <p>Typical 12-month estimate for {money(amount)}. No credit pull happens here.</p>
            <div className="estimate-secure">
              <Check /> Sandbox only — tell the shop when you’re ready to apply with a live lender.
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
