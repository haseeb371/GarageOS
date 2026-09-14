import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { buildFleetStatement, defaultStatementRange, fleetStatementToCsv } from '@/lib/fleet'

type Row = Record<string, unknown> & { id: string }

const querySchema = z.object({
  customerId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['csv', 'json']).optional().default('csv')
})

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = querySchema.safeParse({
    customerId: req.nextUrl.searchParams.get('customerId') || '',
    from: req.nextUrl.searchParams.get('from') || undefined,
    to: req.nextUrl.searchParams.get('to') || undefined,
    format: req.nextUrl.searchParams.get('format') || 'csv'
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide customerId (optional from/to as YYYY-MM-DD).' }, { status: 400 })
  }

  const range = defaultStatementRange()
  const from = parsed.data.from || range.from
  const to = parsed.data.to || range.to

  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.shopId, user.shopId)))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(grouped[row.kind] ||= []).push(data)
  }

  const customer = (grouped.customers || []).find(c => c.id === parsed.data.customerId)
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })

  const statement = buildFleetStatement({
    customer,
    invoices: grouped.invoices || [],
    payments: grouped.payments || [],
    orders: grouped.orders || [],
    vehicles: grouped.vehicles || [],
    from,
    to
  })

  if (parsed.data.format === 'json') {
    return NextResponse.json(statement)
  }

  const csv = fleetStatementToCsv(statement)
  const filename = `fleet-statement-${customer.id}-${from}-to-${to}.csv`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  })
}
