import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { parseReviewCsv, reviewCsvTemplate, reviewRecordsFromImport } from '@/lib/reviews'

type Row = Record<string, unknown> & { id: string }

export const dynamic = 'force-dynamic'

const payload = z.object({
  csv: z.string().min(1)
})

export async function GET() {
  return new NextResponse(reviewCsvTemplate(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="autogaragify-reviews-import-template.csv"'
    }
  })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return NextResponse.json({ error: 'Only Owner, Manager, or Advisor can import reviews.' }, { status: 403 })
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid import.' }, { status: 400 })
  }

  const result = parseReviewCsv(parsed.data.csv)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const rows = await db.select().from(records).where(eq(records.shopId, user.shopId))
  const customers = rows
    .filter(row => row.kind === 'customers')
    .map(row => JSON.parse(row.data) as Row)
  const reviews = reviewRecordsFromImport(result.rows, user.shopId, customers)

  const now = Date.now()
  await db.transaction(async tx => {
    for (const review of reviews) {
      await tx.insert(records).values({
        id: review.id,
        kind: 'reviews',
        shopId: user.shopId,
        data: JSON.stringify(review),
        createdAt: now,
        updatedAt: now
      })
    }
    await tx.insert(auditLog).values({
      actor: user.id,
      action: 'reviews.import',
      entity: 'reviews',
      entityId: 'bulk',
      detail: `Imported ${reviews.length} review(s) from CSV`,
      createdAt: now
    })
  })

  return NextResponse.json({
    ok: true,
    imported: reviews.length,
    message: `Imported ${reviews.length} review(s).`
  })
}
