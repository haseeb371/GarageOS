'use client'

import Link from 'next/link'
import { useState } from 'react'

type Summary = {
  imported: number
  duplicates: number
  failed: number
  message: string
  errorReportCsv?: string
  failures?: Array<{ lineNumber: number; reason: string; business_name: string }>
}

export default function ImportLeadsClient() {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSummary(null)
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      const res = await fetch('/api/leads/import', { method: 'POST', body: data })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Import failed')
      setSummary({
        imported: body.imported,
        duplicates: body.duplicates,
        failed: body.failed,
        message: body.message,
        errorReportCsv: body.errorReportCsv,
        failures: body.failures
      })
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const downloadErrors = () => {
    if (!summary?.errorReportCsv) return
    const blob = new Blob([summary.errorReportCsv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lead-import-errors.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="leads-page">
      <header className="leads-head">
        <div>
          <p className="eyebrow">AutoGaragify sales</p>
          <h1>Import leads</h1>
          <p className="muted">
            Upload <code>auto_repair_leads.csv</code> from the Places API puller. Duplicates are skipped by{' '}
            <code>place_id</code>.
          </p>
          <p className="compliance-banner">
            Outbound AI calling requires B2B-only targets, AI disclosure, and DNC compliance. Confirm
            your legal review before enabling DIALER_ENABLED.
          </p>
          <p className="compliance-note">B2B outreach — honor all do-not-call requests immediately.</p>
        </div>
        <div className="leads-actions">
          <Link className="btn secondary" href="/leads">
            Back to leads
          </Link>
        </div>
      </header>

      <form className="card completion-panel leads-import" onSubmit={onSubmit}>
        <label>
          CSV file
          <input name="file" type="file" accept=".csv,text/csv" required />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Importing…' : 'Import leads'}
        </button>
      </form>

      {error ? <p className="vin-error">{error}</p> : null}

      {summary ? (
        <section className="card completion-panel">
          <h2>Import summary</h2>
          <p>{summary.message}</p>
          <ul>
            <li>
              <b>{summary.imported}</b> imported
            </li>
            <li>
              <b>{summary.duplicates}</b> duplicates skipped
            </li>
            <li>
              <b>{summary.failed}</b> failed validation
            </li>
          </ul>
          {summary.failed > 0 && summary.errorReportCsv ? (
            <button className="btn secondary" type="button" onClick={downloadErrors}>
              Download error report
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
