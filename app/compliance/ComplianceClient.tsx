'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function ComplianceClient(props: {
  violations: Array<{
    id: number
    reason: string
    detail: string
    leadId: string | null
    createdAt: number
  }>
  dnc: Array<{ id: number; phoneDigits: string; reason: string; createdAt: number }>
  stateBlocklist: string
}) {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [states, setStates] = useState(props.stateBlocklist)
  const [busy, setBusy] = useState('')

  const post = async (body: Record<string, unknown>) => {
    setBusy('save')
    try {
      const res = await fetch('/api/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="leads-page">
      <header className="leads-head">
        <div>
          <p className="eyebrow">Compliance</p>
          <h1>AI calling compliance</h1>
        </div>
        <div className="leads-actions">
          <Link className="btn secondary" href="/leads">
            Leads
          </Link>
          <Link className="btn secondary" href="/admin/prompts">
            Prompts
          </Link>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>US state blocklist</h2>
        <p className="muted">Comma-separated codes (e.g. CA,FL). Empty = none blocked.</p>
        <div className="leads-bulk">
          <input value={states} onChange={e => setStates(e.target.value)} placeholder="CA,FL" />
          <button
            type="button"
            disabled={busy === 'save'}
            onClick={() => post({ action: 'set_blocklist', states })}
          >
            Save blocklist
          </button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>DNC phones</h2>
        <div className="leads-bulk">
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone to add" />
          <button
            type="button"
            disabled={busy === 'save'}
            onClick={() => post({ action: 'dnc_add', phone })}
          >
            Add DNC
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Digits</th>
              <th>Reason</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.dnc.map(d => (
              <tr key={d.id}>
                <td>{d.phoneDigits}</td>
                <td>{d.reason}</td>
                <td>{new Date(d.createdAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => post({ action: 'dnc_remove', phoneDigits: d.phoneDigits })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!props.dnc.length ? (
              <tr>
                <td colSpan={4}>No DNC numbers yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Compliance violations</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Reason</th>
              <th>Lead</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {props.violations.map(v => (
              <tr key={v.id}>
                <td>{new Date(v.createdAt).toLocaleString()}</td>
                <td>{v.reason}</td>
                <td>{v.leadId || '—'}</td>
                <td>{v.detail}</td>
              </tr>
            ))}
            {!props.violations.length ? (
              <tr>
                <td colSpan={4}>No violations logged.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  )
}
