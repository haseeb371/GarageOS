import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records, auditLog } from '@/lib/schema'
import { accountingConfigured, accountingProvider, buildAccountingJournal, pushAccountingJournal } from '@/lib/accounting'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
  connectionId: z.string().optional(),
  dryRun: z.boolean().optional().default(false)
})

async function shopData(shopId: string) {
  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(grouped[row.kind] ||= []).push(data)
  }
  return { rows, grouped }
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Bookkeeper'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid sync request.' }, { status: 400 })
  }

  const { grouped, rows } = await shopData(user.shopId)
  const shop = (grouped.shops || [])[0] || { id: user.shopId, name: 'AutoGaragify' }
  const lines = buildAccountingJournal(
    grouped.invoices || [],
    grouped.payments || [],
    grouped.customers || [],
    { from: parsed.data.from, to: parsed.data.to }
  )

  if (parsed.data.dryRun) {
    const mode = accountingProvider()
    return NextResponse.json({
      ok: true,
      dryRun: true,
      mode,
      configured: accountingConfigured(),
      recordsProcessed: lines.length,
      invoices: lines.filter(line => line.type === 'Invoice').length,
      payments: lines.filter(line => line.type === 'Payment').length,
      from: parsed.data.from,
      to: parsed.data.to,
      sample: lines.slice(0, 5),
      message: `Dry run: ${lines.length} journal line(s) for ${parsed.data.from || '…'} → ${parsed.data.to || '…'} (${mode}).`
    })
  }

  const result = await pushAccountingJournal({
    shopId: user.shopId,
    shopName: String(shop.name || 'AutoGaragify'),
    from: parsed.data.from,
    to: parsed.data.to,
    lines
  })

  const now = Date.now()
  const startedAt = new Date(now).toISOString()
  const mode = result.mode || accountingProvider()
  const syncId = `SYNC-${now.toString().slice(-10)}`
  const connection =
    (grouped.integrationConnections || []).find(row => row.id === parsed.data.connectionId) ||
    (grouped.integrationConnections || []).find(row => String(row.category || '').toLowerCase() === 'accounting')

  const syncRun = {
    id: syncId,
    connectionId: connection?.id || '',
    provider: connection?.provider || mode,
    direction: 'Outbound',
    status: result.ok ? (result.sandbox ? 'Sandbox complete' : 'Succeeded') : 'Failed',
    startedAt,
    completedAt: new Date().toISOString(),
    recordsProcessed: result.recordsProcessed,
    error: result.ok ? '' : result.error || 'Sync failed',
    notes: result.ok ? result.message || '' : result.error || '',
    mode,
    externalId: result.externalId || '',
    from: parsed.data.from || '',
    to: parsed.data.to || '',
    shopId: user.shopId
  }

  await db.transaction(async tx => {
    await tx.insert(records).values({
      id: syncId,
      kind: 'syncRuns',
      shopId: user.shopId,
      data: JSON.stringify(syncRun),
      createdAt: now,
      updatedAt: now
    })

    if (connection) {
      const updated = {
        ...connection,
        lastSyncAt: startedAt,
        status: result.ok ? (accountingConfigured() ? 'Connected' : connection.status) : connection.status,
        notes: result.ok
          ? `Last sync: ${result.message || 'ok'}`
          : `Last sync failed: ${result.error || 'unknown error'}`
      }
      const existing = rows.find(row => row.id === connection.id && row.kind === 'integrationConnections')
      if (existing) {
        await tx
          .update(records)
          .set({ data: JSON.stringify(updated), updatedAt: now })
          .where(eq(records.id, connection.id))
      }
    }

    await tx.insert(auditLog).values({
      actor: user.id,
      action: result.ok ? 'accounting.sync' : 'accounting.sync.failed',
      entity: 'syncRuns',
      entityId: syncId,
      detail: result.ok ? result.message || `${lines.length} lines` : result.error || 'failed',
      createdAt: now
    })
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        mode,
        sandbox: result.sandbox,
        syncId,
        recordsProcessed: 0
      },
      { status: result.sandbox ? 503 : 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    mode,
    sandbox: result.sandbox,
    syncId,
    recordsProcessed: result.recordsProcessed,
    externalId: result.externalId || '',
    message: result.message,
    csvExport: `/api/export/accounting?from=${encodeURIComponent(parsed.data.from)}&to=${encodeURIComponent(parsed.data.to)}`
  })
}
