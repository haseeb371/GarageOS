'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AdminPromptsClient(props: {
  active: string
  versions: string[]
  text: string
  fallback: boolean
}) {
  const router = useRouter()
  const [version, setVersion] = useState(props.active)
  const [content, setContent] = useState(props.text)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const activate = async (opts: { create?: boolean }) => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          opts.create
            ? { version, content }
            : { version, activateOnly: true }
        )
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Save failed')
      setMessage(`Active prompt: ${body.version}`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="leads-page">
      <header className="leads-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>AI prompts</h1>
          <p className="muted">
            Active: <b>{props.active}</b>
            {props.fallback ? ' (fell back to v1)' : ''}
          </p>
        </div>
        <Link className="btn secondary" href="/">
          Back
        </Link>
      </header>

      <div className="leads-bulk">
        <label>
          Version
          <input value={version} onChange={e => setVersion(e.target.value)} placeholder="v3" />
        </label>
        <button type="button" disabled={busy} onClick={() => activate({ create: false })}>
          Activate existing
        </button>
        <button type="button" disabled={busy} onClick={() => activate({ create: true })}>
          Save &amp; activate
        </button>
      </div>

      <p className="muted">Available: {props.versions.join(', ') || 'none'}</p>
      {message ? <p>{message}</p> : null}

      <textarea
        className="prompt-editor"
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={24}
      />
    </main>
  )
}
