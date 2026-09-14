import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, ilike, or } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { salesLeads } from '@/lib/schema'
import { LEAD_STATUSES } from '@/lib/leads'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = (sp.get('status') || '').trim()
  const source = (sp.get('source') || '').trim()
  const q = (sp.get('q') || '').trim()
  const page = Math.max(1, Number(sp.get('page') || 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') || 25) || 25))
  const offset = (page - 1) * pageSize

  const filters = [eq(salesLeads.shopId, user.shopId)]
  if (status && LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) {
    filters.push(eq(salesLeads.status, status))
  }
  if (source) {
    filters.push(eq(salesLeads.source, source))
  }
  if (q) {
    const like = `%${q}%`
    filters.push(
      or(
        ilike(salesLeads.businessName, like),
        ilike(salesLeads.phone, like),
        ilike(salesLeads.phoneDigits, like)
      )!
    )
  }

  const where = and(...filters)
  const [totalRow] = await db.select({ value: count() }).from(salesLeads).where(where)
  const rows = await db
    .select()
    .from(salesLeads)
    .where(where)
    .orderBy(desc(salesLeads.createdAt))
    .limit(pageSize)
    .offset(offset)

  const sources = await db
    .selectDistinct({ source: salesLeads.source })
    .from(salesLeads)
    .where(eq(salesLeads.shopId, user.shopId))
    .orderBy(salesLeads.source)

  return NextResponse.json({
    leads: rows,
    total: Number(totalRow?.value || 0),
    page,
    pageSize,
    sources: sources.map(s => s.source).filter(Boolean),
    statuses: LEAD_STATUSES
  })
}
