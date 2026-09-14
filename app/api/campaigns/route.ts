import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { salesCampaigns } from '@/lib/schema'
import { setCampaignStatus } from '@/lib/dialer'

export const dynamic = 'force-dynamic'

export async function GET() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db
    .select()
    .from(salesCampaigns)
    .where(eq(salesCampaigns.shopId, user.shopId))
    .orderBy(desc(salesCampaigns.createdAt))
  return NextResponse.json({ campaigns: rows })
}

export async function PATCH(req: NextRequest) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string }
  const id = String(body.id || '')
  const status = String(body.status || '') as 'running' | 'paused' | 'done'
  if (!id || !['running', 'paused', 'done'].includes(status)) {
    return NextResponse.json({ error: 'id and status (running|paused|done) required' }, { status: 400 })
  }
  await setCampaignStatus(user.shopId, id, status)
  const [row] = await db
    .select()
    .from(salesCampaigns)
    .where(and(eq(salesCampaigns.id, id), eq(salesCampaigns.shopId, user.shopId)))
    .limit(1)
  return NextResponse.json({ ok: true, campaign: row })
}
