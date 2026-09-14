import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import TechClient from './TechClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tech bay | AutoGaragify', robots: { index: false, follow: false } }

export default async function TechPage() {
  const user = await currentUser()
  if (!user) redirect('/login?next=/tech')
  return <TechClient />
}
