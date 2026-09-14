import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { currentUser } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'
import { importLeadsFromCsvText } from '@/lib/leadsImport'

export const dynamic = 'force-dynamic'

function secretOk(header: string | null): boolean {
  const expected = (process.env.LEADS_IMPORT_SECRET || '').trim()
  if (!expected || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function resolveImporter(req: NextRequest) {
  const user = await currentUser()
  if (user && ['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return { shopId: user.shopId, actorId: user.id }
  }

  const secret = req.headers.get('x-leads-import-secret')
  const shopId = (req.headers.get('x-shop-id') || process.env.LEADS_IMPORT_SHOP_ID || '').trim()
  if (secretOk(secret) && shopId) {
    return { shopId, actorId: 'cli-import' }
  }
  return null
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const importer = await resolveImporter(req)
  if (!importer) {
    return NextResponse.json(
      { error: 'Unauthorized. Sign in as Owner/Manager/Advisor or pass LEADS_IMPORT_SECRET + shop id.' },
      { status: 401 }
    )
  }

  const contentType = req.headers.get('content-type') || ''
  let csvText = ''

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    if (file && typeof file === 'object' && 'text' in file) {
      csvText = await (file as File).text()
    } else {
      csvText = String(form.get('csv') || '')
    }
  } else if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { csv?: string }
    csvText = String(body.csv || '')
  } else {
    csvText = await req.text()
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: 'CSV content is required.' }, { status: 400 })
  }

  const imported = await importLeadsFromCsvText(csvText, importer.shopId, importer.actorId)
  if (!imported.ok) {
    return NextResponse.json({ error: imported.error }, { status: 400 })
  }

  const { result } = imported
  return NextResponse.json({
    ok: true,
    imported: result.imported,
    duplicates: result.duplicates,
    failed: result.failed,
    failures: result.failures,
    errorReportCsv: result.errorReportCsv,
    message: `Imported ${result.imported}. Skipped ${result.duplicates} duplicate(s). ${result.failed} failed validation.`
  })
}
