import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { applyAssignmentAction, assignmentElapsedMinutes } from '@/lib/techWorkflow'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  assignmentId: z.string().min(1),
  action: z.enum(['start', 'pause', 'complete'])
})

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor', 'Technician'].includes(user.role)) {
    return NextResponse.json({ error: 'Your role cannot update job timers.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide assignmentId and action.' }, { status: 400 })
  }

  try {
    const now = Date.now()
    const result = await db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.id, parsed.data.assignmentId),
            eq(records.kind, 'assignments'),
            eq(records.shopId, user.shopId)
          )
        )
        .limit(1)
      if (!row) throw new Error('Assignment not found.')
      const assignment = JSON.parse(row.data) as Row
      if (
        user.role === 'Technician' &&
        String(assignment.technician || '').toLowerCase() !== user.name.toLowerCase()
      ) {
        throw new Error('You can only update your own assigned jobs.')
      }

      const updated = applyAssignmentAction(assignment, parsed.data.action, now)
      const clean = { ...updated, shopId: user.shopId }
      await tx
        .update(records)
        .set({ data: JSON.stringify(clean), updatedAt: now })
        .where(and(eq(records.id, row.id), eq(records.shopId, user.shopId)))
      await tx.insert(auditLog).values({
        actor: user.id,
        action: `tech.${parsed.data.action}`,
        entity: 'assignments',
        entityId: row.id,
        detail: `${user.name} ${parsed.data.action} ${assignment.orderId}/${assignment.jobId}`,
        createdAt: now
      })
      return clean
    })

    return NextResponse.json({
      ok: true,
      assignment: {
        ...result,
        elapsedMinutes: assignmentElapsedMinutes(result, Date.now())
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update timer.' },
      { status: 400 }
    )
  }
}
