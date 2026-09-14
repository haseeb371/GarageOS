import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { assignmentElapsedMinutes } from '@/lib/techWorkflow'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    ;(grouped[row.kind] ||= []).push(JSON.parse(row.data) as Row)
  }

  const now = Date.now()
  const mine = (grouped.assignments || []).filter(
    a => String(a.technician || '').toLowerCase() === user.name.toLowerCase()
  )
  const active = mine
    .filter(a => a.status !== 'Completed')
    .sort((a, b) => {
      const rank = (s: unknown) =>
        s === 'In progress' ? 0 : s === 'Paused' ? 1 : s === 'Assigned' ? 2 : 3
      return rank(a.status) - rank(b.status)
    })
  const doneToday = mine.filter(a => {
    if (a.status !== 'Completed') return false
    const day = String(a.completedAt || '').slice(0, 10)
    return day === new Date().toISOString().slice(0, 10)
  })

  const board = active.map(a => {
    const order = (grouped.orders || []).find(o => o.id === a.orderId)
    const job = (Array.isArray(order?.jobs) ? (order!.jobs as Row[]) : []).find(j => j.id === a.jobId)
    const customer = (grouped.customers || []).find(c => c.id === order?.customerId)
    const vehicle = (grouped.vehicles || []).find(v => v.id === order?.vehicleId)
    const inspection = (grouped.inspections || []).find(i => i.orderId === a.orderId)
    return {
      id: a.id,
      status: String(a.status || 'Assigned'),
      orderId: String(a.orderId || ''),
      jobId: String(a.jobId || ''),
      jobName: String(job?.name || a.jobName || a.jobId || 'Job'),
      estimatedHours: Number(a.estimatedHours || job?.laborHours || 0),
      accumulatedMinutes: Number(a.accumulatedMinutes || 0),
      timerStartedAt: a.timerStartedAt ? String(a.timerStartedAt) : null,
      elapsedMinutes: assignmentElapsedMinutes(a, now),
      customerName: String(customer?.name || 'Customer'),
      vehicleLabel: vehicle
        ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
        : 'Vehicle',
      orderStatus: String(order?.status || ''),
      inspectionId: inspection ? String(inspection.id) : null,
      inspectionStatus: inspection ? String(inspection.status || 'Draft') : null
    }
  })

  return NextResponse.json({
    session: { id: user.id, name: user.name, role: user.role },
    board,
    completedToday: doneToday.length,
    serverNow: now
  })
}
