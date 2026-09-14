import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import {
  getActivePromptVersion,
  listPromptVersions,
  loadSystemPrompt
} from '@/lib/aiAgent/prompt'
import { AdminPromptsClient } from './AdminPromptsClient'

export const dynamic = 'force-dynamic'

export default async function AdminPromptsPage() {
  const user = await currentUser()
  if (!user) redirect('/login?mode=login')
  if (!['Owner', 'Manager'].includes(user.role)) redirect('/')

  const active = getActivePromptVersion()
  const versions = listPromptVersions()
  const loaded = loadSystemPrompt(active)

  return (
    <AdminPromptsClient
      active={active}
      versions={versions}
      text={loaded.text}
      fallback={loaded.fallback}
    />
  )
}
