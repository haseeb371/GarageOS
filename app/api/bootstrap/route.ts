import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { records, auditLog, authUsers } from '@/lib/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { ensureShopDefaults } from '@/lib/ensureShopDefaults'
import { buildAutomationContext } from '@/lib/automationRuntime'
import { releaseAutomationJobs } from '@/lib/automations'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'
export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const shopRows = await db.select().from(records).where(and(eq(records.shopId, user.shopId), eq(records.kind, 'shops')))
  const primaryShop = shopRows[0] ? JSON.parse(shopRows[0].data) as { name?: string } : undefined
  await ensureShopDefaults(user.shopId, String(primaryShop?.name || 'Primary shop'))

  // Release due scheduled automations whenever the shop opens the app
  if (['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    const allRows = await db.select().from(records).where(eq(records.shopId, user.shopId))
    const refreshed = allRows.map(row => ({ kind: row.kind, data: JSON.parse(row.data) as Row }))
    const automations = refreshed.filter(row => row.kind === 'workflowAutomations').map(row => row.data)
    const context = buildAutomationContext(refreshed)
    const dueEffects = releaseAutomationJobs(context.automationJobs || [], automations, context)
    if (dueEffects.length) {
      const now = Date.now()
      await db.transaction(async tx => {
        for (const effect of dueEffects) {
          const clean = { ...effect.record, shopId: user.shopId }
          await tx.insert(records).values({
            id: effect.record.id,
            kind: effect.kind,
            shopId: user.shopId,
            data: JSON.stringify(clean),
            createdAt: now,
            updatedAt: now
          }).onConflictDoUpdate({
            target: records.id,
            set: { data: JSON.stringify(clean), kind: effect.kind, shopId: user.shopId, updatedAt: now }
          })
        }
      })
    }
  }

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const state: Record<string, unknown[]> = {}
  for (const row of rows) (state[row.kind] ??= []).push(JSON.parse(row.data))
  const shopUsers = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email, role: authUsers.role, active: authUsers.active }).from(authUsers).where(eq(authUsers.shopId, user.shopId))
  const auditRows = ['Owner', 'Manager'].includes(user.role)
    ? await db.select().from(auditLog).where(inArray(auditLog.actor, shopUsers.map(member => member.id)))
    : await db.select().from(auditLog).where(eq(auditLog.actor, user.id))
  const names = new Map(shopUsers.map(member => [member.id, member.name]))
  const audit = auditRows.slice(-250).reverse().map(entry => ({ ...entry, actorName: names.get(entry.actor) || entry.actor }))
  state.authUsers = shopUsers
  return NextResponse.json({ state, audit, session: user })
}
