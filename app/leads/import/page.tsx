import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'
import ImportLeadsClient from './ImportLeadsClient'

export const dynamic = 'force-dynamic'

export default async function ImportLeadsPage() {
  await ensureSchema()
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) redirect('/leads')
  return <ImportLeadsClient />
}
