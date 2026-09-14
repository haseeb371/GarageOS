import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, desc, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { contactLogs, salesLeads } from '@/lib/schema'
import type { TranscriptChunk } from '@/lib/schema'

export const dynamic = 'force-dynamic'

export default async function LeadTranscriptPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')
  const { id } = await params

  const [lead] = await db
    .select()
    .from(salesLeads)
    .where(and(eq(salesLeads.id, id), eq(salesLeads.shopId, user.shopId)))
    .limit(1)
  if (!lead) notFound()

  const logs = await db
    .select()
    .from(contactLogs)
    .where(and(eq(contactLogs.shopId, user.shopId), eq(contactLogs.leadId, id)))
    .orderBy(desc(contactLogs.createdAt))

  return (
    <main className="leads-page">
      <header className="leads-head">
        <div>
          <p className="eyebrow">Call transcript</p>
          <h1>{lead.businessName}</h1>
          <p className="muted">
            {lead.phone} · status {lead.status}
          </p>
        </div>
        <Link className="btn secondary" href="/leads">
          Back to leads
        </Link>
      </header>

      {!logs.length ? <p>No contact logs yet for this lead.</p> : null}

      {logs.map(log => {
        const chunks = (log.transcript || []) as TranscriptChunk[]
        return (
          <section key={log.id} className="card transcript-card">
            <div className="transcript-meta">
              <span className={`pill ${log.direction}`}>{log.direction}</span>
              <span className={`pill ${log.outcome}`}>{log.outcome}</span>
              <span>{new Date(log.createdAt).toLocaleString()}</span>
              {log.durationSeconds != null ? <span>{log.durationSeconds}s</span> : null}
              {log.aiDisclosure ? <span>AI disclosure ✓</span> : <span>AI disclosure ✗</span>}
            </div>
            {log.recordingUrl ? (
              <p>
                <a href={log.recordingUrl} target="_blank" rel="noreferrer">
                  Open recording
                </a>
              </p>
            ) : (
              <p className="muted">No recording URL.</p>
            )}
            {log.recordingUrl ? (
              <audio controls src={log.recordingUrl} style={{ width: '100%', marginBottom: 12 }}>
                <track kind="captions" />
              </audio>
            ) : null}
            <div className="chat-log">
              {chunks.map((c, i) => (
                <div key={`${log.id}-${i}`} className={`chat-bubble role-${c.role}`}>
                  <div className="chat-role">
                    {c.role} · {new Date(c.at).toLocaleTimeString()}
                  </div>
                  <div className="chat-text">{c.text}</div>
                </div>
              ))}
              {!chunks.length ? <p className="muted">Transcript empty.</p> : null}
            </div>
            {log.detail ? <p className="muted">{log.detail}</p> : null}
          </section>
        )
      })}
    </main>
  )
}
