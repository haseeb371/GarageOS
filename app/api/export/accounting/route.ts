import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { buildAccountingJournal } from '@/lib/accounting'

function csvEscape(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function csvRow(values: unknown[]) {
  return values.map(csvEscape).join(',')
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

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const grouped: Record<string, Array<Record<string, unknown> & { id: string }>> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Record<string, unknown> & { id: string }
    ;(grouped[row.kind] ||= []).push(data)
  }

  const lines = buildAccountingJournal(
    grouped.invoices || [],
    grouped.payments || [],
    grouped.customers || [],
    { from, to }
  )

  const csv = [
    csvRow(['Date', 'Type', 'Reference', 'Customer', 'Repair order', 'Description', 'Debit', 'Credit', 'Method', 'Status']),
    ...lines.map(line =>
      csvRow([
        line.date,
        line.type,
        line.reference,
        line.customer,
        line.repairOrder,
        line.description,
        line.debit ? line.debit.toFixed(2) : '',
        line.credit ? line.credit.toFixed(2) : '',
        line.method,
        line.status
      ])
    )
  ]

  const filename = `autogragify-accounting-${from || 'all'}-to-${to || 'all'}.csv`
  return new Response(csv.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    }
  })
}
