import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default function DemoCallPage() {
  const from = getConfig().TELNYX_FROM_NUMBER || 'Number not configured'
  const telHref = from.startsWith('+') ? `tel:${from}` : undefined

  return (
    <main className="demo-call-page">
      <p className="eyebrow">AutoGaragify</p>
      <h1>Talk to our AI assistant</h1>
      <p className="demo-call-copy">
        Call for a live demo of inbound AI voice — disclosure, shop Q&amp;A, and warm transfer when you
        want a human.
      </p>
      {telHref ? (
        <a className="btn demo-call-btn" href={telHref}>
          Call for a live demo
          <span>{from}</span>
        </a>
      ) : (
        <div className="btn demo-call-btn disabled">
          Call for a live demo
          <span>{from}</span>
        </div>
      )}
      <p className="muted">You will hear an AI assistant — never a pretend human.</p>
    </main>
  )
}
