'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ClipboardCheck, Clock3, LogOut, Pause, Play, RefreshCcw, Wrench } from 'lucide-react'
import { assignmentElapsedMinutes } from '@/lib/techWorkflow'

type BoardJob = {
  id: string
  status: string
  orderId: string
  jobId: string
  jobName: string
  estimatedHours: number
  accumulatedMinutes: number
  timerStartedAt: string | null
  customerName: string
  vehicleLabel: string
  orderStatus: string
  inspectionId: string | null
  inspectionStatus: string | null
}

type InspectionItem = {
  id: string
  area: string
  guidance: string
  result: string
}

type Inspection = {
  id: string
  orderId: string
  status: string
  template: string
  items: InspectionItem[]
}

const formatHours = (minutes: number) => `${(minutes / 60).toFixed(2)}h`

export default function TechClient() {
  const [name, setName] = useState('')
  const [board, setBoard] = useState<BoardJob[]>([])
  const [completedToday, setCompletedToday] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [now, setNow] = useState(Date.now())
  const [activeInspection, setActiveInspection] = useState<Inspection | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/tech/board', { cache: 'no-store' })
      if (response.status === 401) {
        window.location.href = '/login?next=/tech'
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load bay board.')
      setName(body.session?.name || '')
      setBoard(body.board || [])
      setCompletedToday(Number(body.completedToday || 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bay board.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  const act = async (assignmentId: string, action: 'start' | 'pause' | 'complete') => {
    setBusyId(assignmentId)
    setError('')
    try {
      const response = await fetch('/api/tech/assignment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignmentId, action })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Timer update failed.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Timer update failed.')
    } finally {
      setBusyId('')
    }
  }

  const openInspection = async (orderId: string, inspectionId: string | null) => {
    setError('')
    try {
      const qs = new URLSearchParams({ orderId })
      if (inspectionId) qs.set('inspectionId', inspectionId)
      const response = await fetch(`/api/tech/inspection?${qs}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not open inspection.')
      if (body.state === 'missing') {
        const created = await fetch('/api/tech/inspection', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId, createIfMissing: true })
        })
        const createdBody = await created.json()
        if (!created.ok) throw new Error(createdBody.error || 'Could not create inspection.')
        setActiveInspection(createdBody.inspection)
      } else {
        setActiveInspection(body.inspection)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open inspection.')
    }
  }

  const setItemResult = async (itemId: string, result: string) => {
    if (!activeInspection) return
    setBusyId(itemId)
    try {
      const response = await fetch('/api/tech/inspection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: activeInspection.orderId,
          inspectionId: activeInspection.id,
          itemId,
          result
        })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not save checkpoint.')
      setActiveInspection(body.inspection)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save checkpoint.')
    } finally {
      setBusyId('')
    }
  }

  const completeInspection = async () => {
    if (!activeInspection) return
    setBusyId('complete-insp')
    try {
      const response = await fetch('/api/tech/inspection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: activeInspection.orderId,
          inspectionId: activeInspection.id,
          complete: true
        })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not complete inspection.')
      setActiveInspection(body.inspection)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete inspection.')
    } finally {
      setBusyId('')
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <main className="tech-bay">
        <p className="tech-loading">Loading your bay…</p>
      </main>
    )
  }

  if (activeInspection) {
    return (
      <main className="tech-bay">
        <header className="tech-top">
          <button type="button" className="tech-back" onClick={() => setActiveInspection(null)}>
            ← Jobs
          </button>
          <div>
            <b>{activeInspection.template}</b>
            <small>
              {activeInspection.orderId} · {activeInspection.status}
            </small>
          </div>
        </header>
        {error && <p className="tech-error">{error}</p>}
        <div className="tech-inspect-list">
          {(activeInspection.items || []).map(item => (
            <article key={item.id} className="tech-inspect-card">
              <h3>{item.area}</h3>
              <p>{item.guidance}</p>
              <div className="tech-result-row">
                {(['Good', 'Monitor', 'Needs attention'] as const).map(result => (
                  <button
                    key={result}
                    type="button"
                    disabled={busyId === item.id}
                    className={item.result === result ? 'selected' : ''}
                    onClick={() => setItemResult(item.id, result)}
                  >
                    {result}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
        {activeInspection.status !== 'Completed' && (
          <button
            type="button"
            className="tech-primary"
            disabled={busyId === 'complete-insp'}
            onClick={completeInspection}
          >
            <Check size={18} /> Mark inspection complete
          </button>
        )}
      </main>
    )
  }

  return (
    <main className="tech-bay">
      <header className="tech-top">
        <div>
          <small>TECH BAY</small>
          <b>{name || 'Technician'}</b>
        </div>
        <div className="tech-top-actions">
          <button type="button" aria-label="Refresh" onClick={load}>
            <RefreshCcw size={18} />
          </button>
          <Link href="/">Desk</Link>
          <button type="button" aria-label="Sign out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="tech-stats">
        <div>
          <small>Active / queued</small>
          <strong>{board.length}</strong>
        </div>
        <div>
          <small>Completed today</small>
          <strong>{completedToday}</strong>
        </div>
      </div>

      {error && <p className="tech-error">{error}</p>}

      {!board.length ? (
        <section className="tech-empty">
          <Wrench size={36} />
          <h2>No jobs assigned to you</h2>
          <p>Ask an advisor to create a job assignment on Dispatch with your name.</p>
          <Link href="/?section=timeEntries">Open dispatch</Link>
        </section>
      ) : (
        <div className="tech-job-list">
          {board.map(job => {
            const minutes = assignmentElapsedMinutes(
              {
                id: job.id,
                status: job.status,
                accumulatedMinutes: job.accumulatedMinutes,
                timerStartedAt: job.timerStartedAt
              },
              now
            )
            return (
              <article
                key={job.id}
                className={`tech-job status-${job.status.toLowerCase().replaceAll(' ', '-')}`}
              >
                <div className="tech-job-head">
                  <small>
                    {job.orderId} · {job.orderStatus || 'RO'}
                  </small>
                  <span>{job.status}</span>
                </div>
                <h2>{job.jobName}</h2>
                <p>
                  {job.customerName} · {job.vehicleLabel}
                </p>
                <div className="tech-timer">
                  <Clock3 size={16} />
                  <b>{formatHours(minutes)}</b>
                  <span>of {job.estimatedHours.toFixed(1)}h</span>
                </div>
                <div className="tech-actions">
                  {job.status !== 'In progress' && (
                    <button type="button" disabled={busyId === job.id} onClick={() => act(job.id, 'start')}>
                      <Play size={16} /> Start
                    </button>
                  )}
                  {job.status === 'In progress' && (
                    <button type="button" disabled={busyId === job.id} onClick={() => act(job.id, 'pause')}>
                      <Pause size={16} /> Pause
                    </button>
                  )}
                  <button type="button" disabled={busyId === job.id} onClick={() => act(job.id, 'complete')}>
                    <Check size={16} /> Done
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => openInspection(job.orderId, job.inspectionId)}
                  >
                    <ClipboardCheck size={16} /> Inspect
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
