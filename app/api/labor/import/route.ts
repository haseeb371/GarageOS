import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { entriesFromTemplates, laborCsvTemplate, parseLaborGuideCsv } from '@/lib/laborGuide'

export const dynamic = 'force-dynamic'

const payload = z.object({
  mode: z.enum(['template', 'reference-pack', 'csv']).default('csv'),
  csv: z.string().optional(),
  vehicleId: z.string().optional().default('')
})

export async function GET() {
  return new NextResponse(laborCsvTemplate(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="autogragify-labor-guide-template.csv"'
    }
  })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner, Manager, or Advisor can import labor guides.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid labor import.' }, { status: 400 })
  }

  let templates
  let source = 'Imported'
  let sourceReference = 'CSV upload'

  if (parsed.data.mode === 'template') {
    return NextResponse.json({
      ok: true,
      templateUrl: '/api/labor/import',
      hint: 'GET this route to download the CSV template, or POST mode=reference-pack / csv.'
    })
  }

  if (parsed.data.mode === 'reference-pack') {
    const { LABOR_REFERENCE_PACK } = await import('@/lib/laborGuide')
    templates = LABOR_REFERENCE_PACK
    source = 'AutoGragify reference pack'
    sourceReference = 'Sandbox — not licensed MOTOR/AllData data'
  } else {
    const csv = String(parsed.data.csv || '')
    const result = parseLaborGuideCsv(csv)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    templates = result.rows
  }

  const entries = entriesFromTemplates(templates, {
    vehicleId: parsed.data.vehicleId || '',
    source,
    sourceReference,
    shopId: user.shopId
  })

  const now = Date.now()
  await db.transaction(async tx => {
    for (const entry of entries) {
      await tx.insert(records).values({
        id: entry.id,
        kind: 'laborGuideEntries',
        shopId: user.shopId,
        data: JSON.stringify(entry),
        createdAt: now,
        updatedAt: now
      })
    }

    const adapters = await tx.select().from(records).where(eq(records.shopId, user.shopId))
    const motor = adapters.find(row => {
      if (row.kind !== 'integrations') return false
      const data = JSON.parse(row.data) as { name?: string }
      return String(data.name || '').toLowerCase().includes('motor')
    })
    if (motor) {
      const data = JSON.parse(motor.data) as Record<string, unknown>
      await tx
        .update(records)
        .set({
          data: JSON.stringify({
            ...data,
            mode: source.includes('reference') ? 'Sandbox pack' : 'CSV import',
            status: 'Ready',
            notes: `Last import: ${entries.length} labor operations (${source}).`
          }),
          updatedAt: now
        })
        .where(eq(records.id, motor.id))
    }

    await tx.insert(auditLog).values({
      actor: user.id,
      action: 'labor.import',
      entity: 'laborGuideEntries',
      entityId: 'bulk',
      detail: `Imported ${entries.length} labor guide rows (${source})`,
      createdAt: now
    })
  })

  return NextResponse.json({
    ok: true,
    imported: entries.length,
    source,
    message: `Imported ${entries.length} labor guide operation(s).`
  })
}
