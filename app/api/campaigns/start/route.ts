import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'
import { assignLeadsToCampaign, startCampaign } from '@/lib/dialer'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner or Manager can start campaigns.' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    leadIds?: string[]
    assignOnly?: boolean
  }
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Campaign name is required.' }, { status: 400 })

  if (body.assignOnly && Array.isArray(body.leadIds) && body.leadIds.length) {
    const assigned = await assignLeadsToCampaign(user.shopId, body.leadIds, name)
    return NextResponse.json(assigned)
  }

  if (Array.isArray(body.leadIds) && body.leadIds.length) {
    await assignLeadsToCampaign(user.shopId, body.leadIds, name)
  }

  const started = await startCampaign(name, user.shopId)
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: 400 })
  return NextResponse.json(started)
}
