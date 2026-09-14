import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { complianceViolations, dncPhones } from '@/lib/schema'
import { getBlockedStates } from '@/lib/config'
import { ComplianceClient } from './ComplianceClient'

export const dynamic = 'force-dynamic'

export default async function CompliancePage() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) redirect('/')

  const violations = await db
    .select()
    .from(complianceViolations)
    .where(eq(complianceViolations.shopId, user.shopId))
    .orderBy(desc(complianceViolations.createdAt))
    .limit(100)

  const dnc = await db
    .select()
    .from(dncPhones)
    .where(eq(dncPhones.shopId, user.shopId))
    .orderBy(desc(dncPhones.createdAt))
    .limit(200)

  return (
    <ComplianceClient
      violations={violations.map(v => ({
        id: v.id,
        reason: v.reason,
        detail: v.detail,
        leadId: v.leadId,
        createdAt: v.createdAt
      }))}
      dnc={dnc.map(d => ({
        id: d.id,
        phoneDigits: d.phoneDigits,
        reason: d.reason,
        createdAt: d.createdAt
      }))}
      stateBlocklist={getBlockedStates().join(',')}
    />
  )
}
