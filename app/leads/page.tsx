import { redirect } from 'next/navigation'
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { contactLogs, salesLeads } from '@/lib/schema'
import { LEAD_STATUSES } from '@/lib/leads'
import { isDialerEnabled } from '@/lib/config'
import { LeadsClient } from './LeadsClient'

export const dynamic = 'force-dynamic'

export default async function LeadsPage({
  searchParams
}: {
  searchParams: Promise<{
    status?: string
    source?: string
    campaign?: string
    q?: string
    page?: string
  }>
}) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')

  const sp = await searchParams
  const status = (sp.status || '').trim()
  const source = (sp.source || '').trim()
  const campaign = (sp.campaign || '').trim()
  const q = (sp.q || '').trim()
  const page = Math.max(1, Number(sp.page || 1) || 1)
  const pageSize = 25
  const offset = (page - 1) * pageSize

  const filters = [eq(salesLeads.shopId, user.shopId)]
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(salesLeads.status, status))
  }
  if (source) filters.push(eq(salesLeads.source, source))
  if (campaign) filters.push(eq(salesLeads.campaign, campaign))
  if (q) {
    const like = `%${q}%`
    filters.push(
      or(ilike(salesLeads.businessName, like), ilike(salesLeads.phone, like), ilike(salesLeads.phoneDigits, like))!
    )
  }

  const where = and(...filters)
  const [totalRow] = await db.select({ value: count() }).from(salesLeads).where(where)
  const leads = await db
    .select()
    .from(salesLeads)
    .where(where)
    .orderBy(desc(salesLeads.createdAt))
    .limit(pageSize)
    .offset(offset)

  const sources = await db
    .select({ source: salesLeads.source })
    .from(salesLeads)
    .where(eq(salesLeads.shopId, user.shopId))
    .groupBy(salesLeads.source)
    .orderBy(salesLeads.source)

  const campaigns = await db
    .select({ campaign: salesLeads.campaign })
    .from(salesLeads)
    .where(and(eq(salesLeads.shopId, user.shopId), sql`${salesLeads.campaign} <> ''`))
    .groupBy(salesLeads.campaign)
    .orderBy(salesLeads.campaign)

  const statsWhere = campaign
    ? and(eq(salesLeads.shopId, user.shopId), eq(salesLeads.campaign, campaign))
    : eq(salesLeads.shopId, user.shopId)

  const statusCounts = await db
    .select({ status: salesLeads.status, value: count() })
    .from(salesLeads)
    .where(statsWhere)
    .groupBy(salesLeads.status)

  const byStatus = Object.fromEntries(statusCounts.map(r => [r.status, Number(r.value)]))
  const total = Number(totalRow?.value || 0)
  const statsTotal = statusCounts.reduce((sum, r) => sum + Number(r.value), 0)

  const newByCampaignRows = await db
    .select({ campaign: salesLeads.campaign, value: count() })
    .from(salesLeads)
    .where(and(eq(salesLeads.shopId, user.shopId), eq(salesLeads.status, 'new')))
    .groupBy(salesLeads.campaign)

  const campaignNewCounts = Object.fromEntries(
    newByCampaignRows.map(r => [r.campaign || '', Number(r.value)])
  )

  const recentLogs = await db
    .select({
      id: contactLogs.id,
      leadId: contactLogs.leadId,
      outcome: contactLogs.outcome,
      status: contactLogs.status,
      detail: contactLogs.detail,
      direction: contactLogs.direction,
      durationSeconds: contactLogs.durationSeconds,
      createdAt: contactLogs.createdAt,
      businessName: salesLeads.businessName,
      phone: salesLeads.phone
    })
    .from(contactLogs)
    .leftJoin(salesLeads, eq(contactLogs.leadId, salesLeads.id))
    .where(eq(contactLogs.shopId, user.shopId))
    .orderBy(desc(contactLogs.createdAt))
    .limit(8)

  return (
    <LeadsClient
      leads={leads.map(l => ({
        id: l.id,
        businessName: l.businessName,
        phone: l.phone,
        address: l.address,
        website: l.website,
        rating: l.rating,
        status: l.status,
        source: l.source,
        campaign: l.campaign,
        lastContactedAt: l.lastContactedAt
      }))}
      recentCalls={recentLogs.map(r => ({
        id: r.id,
        leadId: r.leadId,
        businessName: r.businessName,
        phone: r.phone,
        outcome: r.outcome,
        status: r.status,
        detail: r.detail,
        direction: r.direction,
        durationSeconds: r.durationSeconds,
        createdAt: r.createdAt
      }))}
      total={total}
      page={page}
      pageSize={pageSize}
      status={status}
      source={source}
      campaign={campaign}
      q={q}
      sources={sources.map(s => s.source).filter(Boolean)}
      campaigns={campaigns.map(c => c.campaign).filter(Boolean)}
      statuses={[...LEAD_STATUSES]}
      stats={{
        total: statsTotal,
        new: byStatus.new || 0,
        contacted: byStatus.contacted || 0,
        interested: byStatus.interested || 0,
        converted: byStatus.converted || 0,
        dnc: byStatus.do_not_call || 0
      }}
      dialerEnabled={isDialerEnabled()}
      campaignNewCounts={campaignNewCounts}
    />
  )
}
