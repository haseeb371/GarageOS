'use client'

import { useEffect, useState } from 'react'

type Slot = { startsAt: number; endsAt: number; label: string; iso: string }

export function DemoBookingClient({ phoneDisplay, telHref }: { phoneDisplay: string; telHref?: string }) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/demo-booking')
      .then(r => r.json())
      .then(body => {
        if (Array.isArray(body.slots)) setSlots(body.slots)
        else setError(body.error || 'Could not load times')
      })
      .catch(() => setError('Could not load times'))
  }, [])

  const book = async () => {
    if (!selected) {
      setError('Pick a time first')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/demo-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: selected, businessName, contactName, phone, email })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Booking failed')
      setMessage(body.message || 'Demo booked')
      setSlots(prev => prev.filter(s => s.startsAt !== selected))
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="demo-booking">
      <div className="demo-call-actions">
        {telHref ? (
          <a className="btn demo-call-btn" href={telHref}>
            Call the sales line now
            <span>{phoneDisplay}</span>
          </a>
        ) : (
          <div className="btn demo-call-btn disabled">
            Call the sales line now
            <span>{phoneDisplay}</span>
          </div>
        )}
      </div>

      <section className="card demo-book-card">
        <h2>Or book a 15-minute product demo</h2>
        <p className="muted">
          Pick an open calendar slot. Someone from AutoGaragify can attend that time — phone or screen share.
        </p>

        <div className="demo-slot-grid">
          {slots.map(slot => (
            <button
              key={slot.startsAt}
              type="button"
              className={selected === slot.startsAt ? 'demo-slot selected' : 'demo-slot'}
              onClick={() => setSelected(slot.startsAt)}
            >
              {slot.label}
            </button>
          ))}
          {!slots.length && !error ? <p className="muted">Loading open times…</p> : null}
        </div>

        <div className="demo-book-form">
          <label>
            Shop name
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your shop" />
          </label>
          <label>
            Your name
            <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Owner / manager" />
          </label>
          <label>
            Phone
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Callback number" />
          </label>
          <label>
            Email
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Optional" />
          </label>
        </div>

        <button className="btn" type="button" disabled={busy || !selected} onClick={book}>
          {busy ? 'Booking…' : 'Book demo on calendar'}
        </button>
        {message ? <p className="demo-book-ok">{message}</p> : null}
        {error ? <p className="demo-book-err">{error}</p> : null}
      </section>
    </div>
  )
}
