import { getConfig } from '@/lib/config'
import { DemoBookingClient } from './DemoBookingClient'

export const dynamic = 'force-dynamic'

export default function DemoCallPage() {
  const from = getConfig().TELNYX_FROM_NUMBER || 'Number not configured'
  const telHref = from.startsWith('+') ? `tel:${from}` : undefined

  return (
    <main className="demo-call-page">
      <p className="eyebrow">AutoGaragify</p>
      <h1>Talk with sales</h1>
      <p className="demo-call-copy">
        Call our sales line anytime — an automated assistant answers, pitches the product naturally, and can
        book a live demo on our calendar. Or skip the phone and reserve a 15-minute slot below.
      </p>
      <DemoBookingClient phoneDisplay={from} telHref={telHref} />
      <p className="muted">Calls disclose they are automated — then talk products like a normal sales intro.</p>
    </main>
  )
}
