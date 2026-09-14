import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'
import { setCampaignStatus } from '@/lib/dialer'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await ctx.params
  await setCampaignStatus(user.shopId, id, 'paused')
  return NextResponse.json({ ok: true, id, status: 'paused' })
}
