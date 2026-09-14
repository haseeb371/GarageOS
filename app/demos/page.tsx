import { redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'
import { formatDemoSlot, listUpcomingDemos } from '@/lib/salesCalendar'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function DemosPage() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    redirect('/')
  }

  const shopId = getConfig().LEADS_IMPORT_SHOP_ID || user.shopId
  const demos = await listUpcomingDemos(shopId, 40)
  const salesPhone = getConfig().TELNYX_FROM_NUMBER

  return (
    <main className="leads-page">
      <div className="leads-head">
        <div>
          <p className="eyebrow">Sales calendar</p>
          <h1>Demo appointments</h1>
          <p className="muted">
            Buyers book these from the website or during an inbound/outbound AI call. Attend by phone
            {salesPhone ? ` (${salesPhone})` : ''} or screen share at the scheduled time.
          </p>
        </div>
        <div className="leads-actions">
          <Link className="btn secondary" href="/demo-call">
            Public booking page
          </Link>
          <Link className="btn secondary" href="/leads">
            Leads
          </Link>
        </div>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Shop</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {demos.map(d => (
              <tr key={d.id}>
                <td>
                  <b>{formatDemoSlot(d.startsAt, d.timezone)}</b>
                </td>
                <td>{d.businessName || '—'}</td>
                <td>{d.contactName || '—'}</td>
                <td>{d.phone || '—'}</td>
                <td>{d.source}</td>
                <td>
                  <span className={`pill ${d.status}`}>{d.status}</span>
                </td>
              </tr>
            ))}
            {!demos.length ? (
              <tr>
                <td colSpan={6}>No upcoming demos yet. Share /demo-call or take inbound calls on the sales DID.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  )
}
