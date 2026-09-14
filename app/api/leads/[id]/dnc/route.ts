import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { dncPhones, salesLeads } from '@/lib/schema'
import { logLeadContact } from '@/lib/leadsImport'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const [lead] = await db
    .select()
    .from(salesLeads)
    .where(and(eq(salesLeads.id, id), eq(salesLeads.shopId, user.shopId)))
    .limit(1)

  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const now = Date.now()
  await db
    .update(salesLeads)
    .set({ status: 'do_not_call', updatedAt: now })
    .where(eq(salesLeads.id, lead.id))

  if (lead.phoneDigits) {
    await db
      .insert(dncPhones)
      .values({
        shopId: user.shopId,
        phoneDigits: lead.phoneDigits,
        reason: 'Manual DNC from leads UI',
        createdAt: now
      })
      .onConflictDoNothing()
  }

  await logLeadContact({
    shopId: user.shopId,
    leadId: lead.id,
    actorId: user.id,
    outcome: 'do_not_call',
    detail: 'Lead marked Do Not Call'
  })

  return NextResponse.json({ ok: true, status: 'do_not_call', message: 'Lead marked Do Not Call.' })
}
