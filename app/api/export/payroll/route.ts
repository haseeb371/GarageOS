import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'

function csvEscape(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function csvRow(values: unknown[]) {
  return values.map(csvEscape).join(',')
}

function hoursBetween(started: string, ended: string | null | undefined) {
  if (!started || !ended) return ''
  const ms = new Date(ended).getTime() - new Date(started).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  return (ms / 3600000).toFixed(2)
}

export async function GET(request: Request) {
  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  if (!['Owner', 'Manager', 'Bookkeeper'].includes(user.role)) {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const inRange = (value: string) => (!from || value >= from) && (!to || value <= to)

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const orders = new Map<string, Record<string, unknown>>()
  for (const row of rows.filter(entry => entry.kind === 'orders')) {
    orders.set(row.id, JSON.parse(row.data))
  }

  const lines = [
    csvRow([
      'Date',
      'Technician',
      'Record type',
      'Reference',
      'Repair order',
      'Started',
      'Ended',
      'Actual hours',
      'Estimated hours',
      'Status',
      'Notes'
    ])
  ]

  for (const row of rows.filter(entry => entry.kind === 'timeEntries')) {
    const entry = JSON.parse(row.data) as Record<string, unknown>
    const date = String(entry.started || '').slice(0, 10)
    if (!inRange(date)) continue
    lines.push(
      csvRow([
        date,
        entry.technician,
        entry.type || 'Time entry',
        entry.id,
        entry.orderId,
        entry.started,
        entry.ended || 'Running',
        hoursBetween(String(entry.started), entry.ended ? String(entry.ended) : undefined),
        '',
        entry.ended ? 'Completed' : 'Running',
        ''
      ])
    )
  }

  for (const row of rows.filter(entry => entry.kind === 'assignments')) {
    const assignment = JSON.parse(row.data) as Record<string, unknown>
    const date = String(assignment.completedAt || assignment.assignedAt || '').slice(0, 10)
    if (!inRange(date)) continue
    const order = orders.get(String(assignment.orderId || ''))
    const job = Array.isArray(order?.jobs)
      ? (order.jobs as Record<string, unknown>[]).find(item => item.id === assignment.jobId)
      : undefined
    lines.push(
      csvRow([
        date,
        assignment.technician,
        'Job assignment',
        assignment.id,
        assignment.orderId,
        assignment.assignedAt,
        assignment.completedAt || '',
        assignment.accumulatedMinutes
          ? (Number(assignment.accumulatedMinutes) / 60).toFixed(2)
          : '',
        assignment.estimatedHours,
        assignment.status,
        job?.name || assignment.jobId || ''
      ])
    )
  }

  const filename = `autogragify-payroll-${from || 'all'}-to-${to || 'all'}.csv`
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    }
  })
}
