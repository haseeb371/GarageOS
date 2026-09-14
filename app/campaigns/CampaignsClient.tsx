'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Campaign = {
  id: string
  name: string
  status: string
  totalLeads: number
  dialed: number
  interested: number
  converted: number
  startedAt: number | null
  createdAt: number
}

export function CampaignsClient(props: {
  campaigns: Campaign[]
  dialerEnabled: boolean
  inbound: { total: number; dialed: number; interested: number; converted: number }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState('')

  const action = async (id: string, path: 'start' | 'pause' | 'resume' | 'done') => {
    setBusy(`${id}-${path}`)
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/${path}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Update failed')
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Update failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="leads-page">
      <header className="leads-head">
        <div>
          <p className="eyebrow">Sales dialer</p>
          <h1>Campaigns</h1>
          <p className="compliance-banner">
            Outbound AI calling requires B2B-only targets, AI disclosure, and DNC compliance. Confirm
            your legal review before enabling DIALER_ENABLED.
          </p>
          {!props.dialerEnabled ? (
            <p className="muted">Dialer is off (DIALER_ENABLED=false). Nothing will dial.</p>
          ) : null}
        </div>
        <div className="leads-actions">
          <Link className="btn secondary" href="/compliance">
            Compliance
          </Link>
          <Link className="btn secondary" href="/leads">
            Leads
          </Link>
          <Link className="btn" href="/demo-call">
            Demo call
          </Link>
        </div>
      </header>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Total</th>
              <th>Dialed</th>
              <th>Interested</th>
              <th>Converted</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>Inbound</b>
                <small className="muted">Pseudo-campaign · direction=inbound</small>
              </td>
              <td>
                <span className="pill running">inbound</span>
              </td>
              <td>{props.inbound.total}</td>
              <td>{props.inbound.dialed}</td>
              <td>{props.inbound.interested}</td>
              <td>{props.inbound.converted}</td>
              <td>—</td>
              <td>
                <Link href="/demo-call">Demo line</Link>
              </td>
            </tr>
            {props.campaigns.map(c => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b>
                </td>
                <td>
                  <span className={`pill ${c.status}`}>{c.status}</span>
                </td>
                <td>{c.totalLeads}</td>
                <td>{c.dialed}</td>
                <td>{c.interested}</td>
                <td>{c.converted}</td>
                <td>{c.startedAt ? new Date(c.startedAt).toLocaleString() : '—'}</td>
                <td className="record-actions">
                  {c.status !== 'running' && c.status !== 'done' ? (
                    <button
                      disabled={busy.startsWith(c.id) || !props.dialerEnabled}
                      onClick={() => action(c.id, 'start')}
                    >
                      Start
                    </button>
                  ) : null}
                  {c.status === 'running' ? (
                    <button disabled={busy.startsWith(c.id)} onClick={() => action(c.id, 'pause')}>
                      Pause
                    </button>
                  ) : null}
                  {c.status === 'paused' ? (
                    <button
                      disabled={busy.startsWith(c.id) || !props.dialerEnabled}
                      onClick={() => action(c.id, 'resume')}
                    >
                      Resume
                    </button>
                  ) : null}
                  {c.status !== 'done' ? (
                    <button disabled={busy.startsWith(c.id)} onClick={() => action(c.id, 'done')}>
                      Done
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!props.campaigns.length ? (
              <tr>
                <td colSpan={8}>
                  No outbound campaigns yet. Assign a name on <Link href="/leads">/leads</Link> and
                  start.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  )
}
