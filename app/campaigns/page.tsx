import { redirect } from 'next/navigation'
import { and, count, desc, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { contactLogs, salesCampaigns } from '@/lib/schema'
import { isDialerEnabled } from '@/lib/config'
import { CampaignsClient } from './CampaignsClient'

export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')

  const campaigns = await db
    .select()
    .from(salesCampaigns)
    .where(eq(salesCampaigns.shopId, user.shopId))
    .orderBy(desc(salesCampaigns.createdAt))

  const [inboundRow] = await db
    .select({ value: count() })
    .from(contactLogs)
    .where(and(eq(contactLogs.shopId, user.shopId), eq(contactLogs.direction, 'inbound')))

  const inboundLogs = await db
    .select()
    .from(contactLogs)
    .where(and(eq(contactLogs.shopId, user.shopId), eq(contactLogs.direction, 'inbound')))
    .orderBy(desc(contactLogs.createdAt))
    .limit(50)

  const inboundInterested = inboundLogs.filter(l => l.outcome === 'interested').length
  const inboundConverted = inboundLogs.filter(l => l.outcome === 'converted').length

  return (
    <CampaignsClient
      dialerEnabled={isDialerEnabled()}
      inbound={{
        total: Number(inboundRow?.value || 0),
        dialed: Number(inboundRow?.value || 0),
        interested: inboundInterested,
        converted: inboundConverted
      }}
      campaigns={campaigns.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalLeads: c.totalLeads,
        dialed: c.dialed,
        interested: c.interested,
        converted: c.converted,
        startedAt: c.startedAt,
        createdAt: c.createdAt
      }))}
    />
  )
}
