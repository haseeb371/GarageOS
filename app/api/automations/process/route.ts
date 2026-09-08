import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { buildAutomationContext } from '@/lib/automationRuntime'
import { releaseAutomationJobs } from '@/lib/automations'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  jobId: z.string().optional(),
  approve: z.boolean().optional()
})

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner or Manager can process automations.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 })
  }

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const refreshed = rows.map(row => ({ kind: row.kind, data: JSON.parse(row.data) as Row }))
  const automations = refreshed.filter(row => row.kind === 'workflowAutomations').map(row => row.data)
  const context = buildAutomationContext(refreshed)
  const jobs = context.automationJobs || []

  if (parsed.data.jobId) {
    const job = jobs.find(row => row.id === parsed.data.jobId)
    if (!job) return NextResponse.json({ error: 'Automation job not found.' }, { status: 404 })
  }

  const effects = releaseAutomationJobs(jobs, automations, context, {
    jobId: parsed.data.jobId,
    forceApprove: Boolean(parsed.data.approve && parsed.data.jobId)
  })

  if (!effects.length) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      message: parsed.data.jobId
        ? 'Nothing to process for that job (already completed, cancelled, or not due yet).'
        : 'No due automation jobs right now.'
    })
  }

  const now = Date.now()
  await db.transaction(async tx => {
    for (const effect of effects) {
      const clean = { ...effect.record, shopId: user.shopId }
      await tx.insert(records).values({
        id: effect.record.id,
        kind: effect.kind,
        shopId: user.shopId,
        data: JSON.stringify(clean),
        createdAt: now,
        updatedAt: now
      }).onConflictDoUpdate({
        target: records.id,
        set: { data: JSON.stringify(clean), kind: effect.kind, shopId: user.shopId, updatedAt: now }
      })
      if (effect.kind !== 'workflowAutomations') {
        await tx.insert(auditLog).values({
          actor: user.id,
          action: parsed.data.approve ? 'automation_approve' : 'automation',
          entity: effect.kind,
          entityId: effect.record.id,
          detail: `Automation process wrote ${effect.record.id}`,
          createdAt: now
        })
      }
    }
  })

  const completed = effects.filter(e => e.kind === 'automationJobs' && e.record.status === 'Completed').length
  return NextResponse.json({
    ok: true,
    processed: completed,
    created: effects.filter(e => !['workflowAutomations', 'automationJobs'].includes(e.kind)).length,
    message: completed
      ? `Processed ${completed} automation job(s).`
      : 'Automation queue updated.'
  })
}
