import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { previewAutomation } from '@/lib/automations'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  workflowId: z.string().min(1)
})

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner or Manager can test automations.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid test request.' }, { status: 400 })
  }

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const state: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(state[row.kind] ||= []).push(data)
  }

  const workflow = (state.workflowAutomations || []).find(row => row.id === parsed.data.workflowId)
  if (!workflow) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 })

  const preview = previewAutomation(workflow, state)
  if (!preview.ok) return NextResponse.json({ error: preview.message }, { status: 400 })

  return NextResponse.json({
    ok: true,
    message: preview.message,
    effects: preview.effects.map(effect => ({
      kind: effect.kind,
      id: effect.record.id,
      summary: String(effect.record.subject || effect.record.name || effect.record.service || effect.record.status || effect.record.id)
    }))
  })
}
