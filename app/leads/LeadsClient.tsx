'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

type LeadRow = {
  id: string
  businessName: string
  phone: string
  address: string
  website: string | null
  rating: number | null
  status: string
  source: string
  campaign: string
  lastContactedAt: number | null
}

type Stats = {
  total: number
  new: number
  contacted: number
  interested: number
  converted: number
  dnc: number
}

type RecentCall = {
  id: number
  leadId: string | null
  businessName: string | null
  phone: string | null
  outcome: string
  status: string
  detail: string
  direction: string
  durationSeconds: number | null
  createdAt: number
}

export function LeadsClient(props: {
  leads: LeadRow[]
  recentCalls: RecentCall[]
  total: number
  page: number
  pageSize: number
  status: string
  source: string
  campaign: string
  q: string
  sources: string[]
  campaigns: string[]
  statuses: string[]
  stats: Stats
  dialerEnabled: boolean
  campaignNewCounts: Record<string, number>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [campaignName, setCampaignName] = useState(props.campaign || '')
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize))

  const startTarget = (campaignName.trim() || props.campaign).trim()
  const selectedNew = props.leads.filter(l => selected.includes(l.id) && l.status === 'new').length
  const campaignNew = startTarget ? props.campaignNewCounts[startTarget] || 0 : 0
  const hasNewLeads = selectedNew > 0 || (startTarget ? campaignNew > 0 : false)
  const startDisabledReason = !props.dialerEnabled
    ? 'Mass dialer is off until legal review'
    : !startTarget
      ? 'Enter or select a campaign name'
      : !hasNewLeads
        ? 'Campaign needs ≥1 lead with status “new”'
        : ''
  const canStart = !startDisabledReason

  const allSelected = useMemo(
    () => props.leads.length > 0 && props.leads.every(l => selected.includes(l.id)),
    [props.leads, selected]
  )

  const hrefFor = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams()
    const status = overrides.status ?? props.status
    const source = overrides.source ?? props.source
    const campaign = overrides.campaign ?? props.campaign
    const q = overrides.q ?? props.q
    const page = overrides.page ?? props.page
    if (status) params.set('status', String(status))
    if (source) params.set('source', String(source))
    if (campaign) params.set('campaign', String(campaign))
    if (q) params.set('q', String(q))
    if (Number(page) > 1) params.set('page', String(page))
    const qs = params.toString()
    return qs ? `/leads?${qs}` : '/leads'
  }

  const toggleAll = () => {
    if (allSelected) setSelected([])
    else setSelected(props.leads.map(l => l.id))
  }

  const toggleOne = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const callLead = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(id)}/call`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Call failed')
      window.alert(body.message || 'Call started')
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Call failed')
    } finally {
      setBusy('')
    }
  }

  const markDnc = async (id: string) => {
    if (!window.confirm('Mark this lead as Do Not Call? Future calls will be blocked.')) return
    setBusy(id)
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(id)}/dnc`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Update failed')
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Update failed')
    } finally {
      setBusy('')
    }
  }

  const assignCampaign = async () => {
    if (!campaignName.trim()) {
      window.alert('Enter a campaign name')
      return
    }
    if (!selected.length) {
      window.alert('Select one or more leads')
      return
    }
    setBusy('campaign')
    try {
      const res = await fetch('/api/campaigns/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaignName.trim(), leadIds: selected, assignOnly: true })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Assign failed')
      setSelected([])
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Assign failed')
    } finally {
      setBusy('')
    }
  }

  const startCampaign = async () => {
    if (startDisabledReason) {
      window.alert(startDisabledReason)
      return
    }
    const name = startTarget
    setBusy('start')
    try {
      const res = await fetch('/api/campaigns/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          leadIds: selected.length ? selected : undefined
        })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Start failed')
      window.alert(`Campaign started · ${body.assigned ?? 0} lead(s)`)
      router.refresh()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Start failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="leads-page">
      <div className="leads-head">
        <div>
          <p className="eyebrow">AutoGaragify sales</p>
          <h1>Leads</h1>
          <p className="compliance-banner">
            Outbound calling is for B2B shop owners only. Keep automated disclosure on, honor Do Not
            Call, and finish legal review before turning on the mass dialer.
          </p>
        </div>
        <div className="leads-actions">
          <Link className="btn secondary" href="/campaigns">
            Campaigns
          </Link>
          <Link className="btn secondary" href="/">
            Back to app
          </Link>
          <Link className="btn" href="/leads/import">
            Import CSV
          </Link>
        </div>
      </div>

      <div className="leads-stats">
        <span>
          <b>{props.stats.total}</b> total
        </span>
        <span>
          <b>{props.stats.new}</b> new
        </span>
        <span>
          <b>{props.stats.contacted}</b> contacted
        </span>
        <span>
          <b>{props.stats.interested}</b> interested
        </span>
        <span>
          <b>{props.stats.converted}</b> converted
        </span>
        <span>
          <b>{props.stats.dnc}</b> dnc
        </span>
      </div>

      <section className="card recent-calls">
        <h2>Recent calls</h2>
        {props.recentCalls.length ? (
          <ul className="recent-calls-list">
            {props.recentCalls.map(call => (
              <li key={call.id}>
                <div>
                  <strong>{call.businessName || call.detail || 'Unknown contact'}</strong>
                  <small className="muted">
                    {call.phone || '—'} · {call.direction} · {new Date(call.createdAt).toLocaleString()}
                    {call.durationSeconds != null ? ` · ${call.durationSeconds}s` : ''}
                  </small>
                </div>
                <div className="recent-calls-meta">
                  <span className={`pill ${call.outcome}`}>{call.outcome}</span>
                  {call.leadId ? (
                    <Link href={`/leads/${encodeURIComponent(call.leadId)}/transcript`}>
                      Transcript
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No calls logged yet. After a test or campaign call, outcomes and transcripts show here.
          </p>
        )}
      </section>

      <form className="leads-filters" method="get" action="/leads">
        <label>
          Status
          <select name="status" defaultValue={props.status}>
            <option value="">All</option>
            {props.statuses.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select name="source" defaultValue={props.source}>
            <option value="">All</option>
            {props.sources.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Campaign
          <select name="campaign" defaultValue={props.campaign}>
            <option value="">All</option>
            {props.campaigns.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Search
          <input name="q" defaultValue={props.q} placeholder="Business name or phone" />
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      <div className="leads-bulk">
        <input
          value={campaignName}
          onChange={e => setCampaignName(e.target.value)}
          placeholder="Campaign name"
        />
        <button type="button" disabled={busy === 'campaign'} onClick={assignCampaign}>
          Assign campaign
        </button>
        <button
          type="button"
          disabled={!canStart || busy === 'start'}
          title={startDisabledReason || 'Start dialer campaign'}
          onClick={startCampaign}
        >
          Start campaign
        </button>
        {startDisabledReason ? <small className="muted dialer-status">{startDisabledReason}</small> : null}
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Business</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Last contacted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.leads.map(lead => (
              <tr key={lead.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(lead.id)}
                    onChange={() => toggleOne(lead.id)}
                    aria-label={`Select ${lead.businessName}`}
                  />
                </td>
                <td>
                  <b>{lead.businessName}</b>
                  {lead.source ? <small className="muted">{lead.source}</small> : null}
                </td>
                <td>{lead.phone}</td>
                <td>{lead.address || '—'}</td>
                <td>{lead.campaign || '—'}</td>
                <td>
                  <span className={`pill ${lead.status}`}>{lead.status}</span>
                </td>
                <td>
                  {lead.lastContactedAt
                    ? new Date(lead.lastContactedAt).toLocaleString()
                    : '—'}
                </td>
                <td className="record-actions">
                  {lead.status !== 'do_not_call' ? (
                    <button
                      disabled={busy === lead.id || !props.dialerEnabled}
                      title={
                        props.dialerEnabled
                          ? 'Place outbound AI call now'
                          : 'Mass dialer is off — tracked test calls still work from the team'
                      }
                      onClick={() => callLead(lead.id)}
                    >
                      {busy === lead.id ? '…' : 'Call now'}
                    </button>
                  ) : null}
                  <Link href={`/leads/${encodeURIComponent(lead.id)}/transcript`}>View transcript</Link>
                  {lead.status !== 'do_not_call' ? (
                    <button disabled={busy === lead.id} onClick={() => markDnc(lead.id)}>
                      Mark Do Not Call
                    </button>
                  ) : (
                    <small className="muted">Do not call</small>
                  )}
                </td>
              </tr>
            ))}
            {!props.leads.length ? (
              <tr>
                <td colSpan={8}>
                  No leads for this shop yet. <Link href="/leads/import">Import CSV</Link>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <nav className="leads-pager">
        <span>
          Page {props.page} of {pages} · {props.total} lead(s)
        </span>
        <div>
          {props.page > 1 ? (
            <Link className="btn secondary" href={hrefFor({ page: props.page - 1 })}>
              Previous
            </Link>
          ) : null}
          {props.page < pages ? (
            <Link className="btn secondary" href={hrefFor({ page: props.page + 1 })}>
              Next
            </Link>
          ) : null}
        </div>
      </nav>
    </main>
  )
}
