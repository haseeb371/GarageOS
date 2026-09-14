import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import {
  activatePromptVersion,
  getActivePromptVersion,
  listPromptVersions,
  loadSystemPrompt,
  readPromptFile
} from '@/lib/aiAgent/prompt'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const active = getActivePromptVersion()
  const versions = listPromptVersions()
  const loaded = loadSystemPrompt(active)
  return NextResponse.json({
    active,
    versions,
    text: loaded.text,
    fallback: loaded.fallback
  })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as {
    version?: string
    content?: string
    activateOnly?: boolean
  }
  const version = String(body.version || '').trim()
  if (!version) return NextResponse.json({ error: 'version required' }, { status: 400 })

  try {
    if (body.activateOnly) {
      const existing = readPromptFile(version)
      if (!existing) return NextResponse.json({ error: 'Prompt file not found' }, { status: 404 })
      const result = activatePromptVersion(version)
      return NextResponse.json({ ok: true, ...result })
    }
    if (!body.content?.trim()) {
      return NextResponse.json({ error: 'content required to create/update' }, { status: 400 })
    }
    const result = activatePromptVersion(version, body.content)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save prompt' },
      { status: 500 }
    )
  }
}
