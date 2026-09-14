/**
 * Sales lead import + contact helpers for AutoGaragify.
 * Shared by /api/leads/import, CLI runner, and unit tests.
 */

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'interested',
  'not_interested',
  'converted',
  'do_not_call'
] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type LeadCsvRow = {
  business_name: string
  phone: string
  address: string
  website: string
  rating: string
  review_count: string
  place_id: string
  query_source: string
  date_pulled: string
  campaign?: string
  lineNumber: number
}

export type NormalizedLeadInput = {
  businessName: string
  phone: string
  phoneDigits: string
  address: string
  website: string | null
  rating: number | null
  reviewCount: number | null
  placeId: string
  source: string
  campaign?: string
}

export type LeadImportFailure = {
  lineNumber: number
  business_name: string
  phone: string
  place_id: string
  reason: string
}

export type LeadImportResult = {
  imported: number
  duplicates: number
  failed: number
  failures: LeadImportFailure[]
  importedIds: string[]
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

/** Strip non-digits; accept 10-digit US or 11-digit starting with 1. Format (XXX) XXX-XXXX. */
export function normalizeUsPhone(input: string):
  | { ok: true; formatted: string; digits: string }
  | { ok: false; error: string } {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, error: 'Phone is required' }

  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  if (digits.length !== 10) {
    return { ok: false, error: 'Phone must be 10 US digits (or 11 starting with 1)' }
  }
  if (digits[0] === '0' || digits[0] === '1') {
    return { ok: false, error: 'US phone area code cannot start with 0 or 1' }
  }

  const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  return { ok: true, formatted, digits }
}

export function parseLeadCsv(csv: string):
  | { ok: true; rows: LeadCsvRow[] }
  | { ok: false; error: string; rows: LeadCsvRow[] } {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim())

  if (lines.length < 2) {
    return { ok: false, error: 'CSV needs a header row and at least one data row.', rows: [] }
  }

  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''))
  const col = (...names: string[]) => header.findIndex(h => names.includes(h))

  const businessIdx = col('business_name', 'businessname', 'name')
  const phoneIdx = col('phone', 'phonenumber', 'tel')
  const addressIdx = col('address', 'formatted_address', 'formattedaddress')
  const websiteIdx = col('website', 'websiteuri', 'url')
  const ratingIdx = col('rating')
  const reviewIdx = col('review_count', 'reviewcount', 'user_ratings_total')
  const placeIdx = col('place_id', 'placeid')
  const sourceIdx = col('query_source', 'querysource', 'source')
  const dateIdx = col('date_pulled', 'datepulled')
  const campaignIdx = col('campaign')

  if (businessIdx < 0 || phoneIdx < 0 || placeIdx < 0) {
    return {
      ok: false,
      error: 'CSV header must include business_name, phone, and place_id.',
      rows: []
    }
  }

  const rows: LeadCsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    rows.push({
      business_name: cells[businessIdx] || '',
      phone: cells[phoneIdx] || '',
      address: addressIdx >= 0 ? cells[addressIdx] || '' : '',
      website: websiteIdx >= 0 ? cells[websiteIdx] || '' : '',
      rating: ratingIdx >= 0 ? cells[ratingIdx] || '' : '',
      review_count: reviewIdx >= 0 ? cells[reviewIdx] || '' : '',
      place_id: cells[placeIdx] || '',
      query_source: sourceIdx >= 0 ? cells[sourceIdx] || '' : '',
      date_pulled: dateIdx >= 0 ? cells[dateIdx] || '' : '',
      campaign: campaignIdx >= 0 ? cells[campaignIdx] || '' : '',
      lineNumber: i + 1
    })
  }

  return { ok: true, rows }
}

export function validateLeadRow(
  row: LeadCsvRow
): { ok: true; lead: NormalizedLeadInput } | { ok: false; failure: LeadImportFailure } {
  const businessName = row.business_name.trim()
  const placeId = row.place_id.trim()
  if (!businessName) {
    return {
      ok: false,
      failure: {
        lineNumber: row.lineNumber,
        business_name: row.business_name,
        phone: row.phone,
        place_id: row.place_id,
        reason: 'business_name is required'
      }
    }
  }
  if (!placeId) {
    return {
      ok: false,
      failure: {
        lineNumber: row.lineNumber,
        business_name: row.business_name,
        phone: row.phone,
        place_id: row.place_id,
        reason: 'place_id is required'
      }
    }
  }

  const phone = normalizeUsPhone(row.phone)
  if (!phone.ok) {
    return {
      ok: false,
      failure: {
        lineNumber: row.lineNumber,
        business_name: row.business_name,
        phone: row.phone,
        place_id: row.place_id,
        reason: phone.error
      }
    }
  }

  const ratingRaw = row.rating.trim()
  let rating: number | null = null
  if (ratingRaw) {
    const n = Number(ratingRaw)
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        failure: {
          lineNumber: row.lineNumber,
          business_name: row.business_name,
          phone: row.phone,
          place_id: row.place_id,
          reason: 'rating must be a number'
        }
      }
    }
    rating = n
  }

  const reviewRaw = row.review_count.trim()
  let reviewCount: number | null = null
  if (reviewRaw) {
    const n = Number(reviewRaw)
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return {
        ok: false,
        failure: {
          lineNumber: row.lineNumber,
          business_name: row.business_name,
          phone: row.phone,
          place_id: row.place_id,
          reason: 'review_count must be an integer'
        }
      }
    }
    reviewCount = n
  }

  const website = row.website.trim() || null

  return {
    ok: true,
    lead: {
      businessName,
      phone: phone.formatted,
      phoneDigits: phone.digits,
      address: row.address.trim(),
      website,
      rating,
      reviewCount,
      placeId,
      source: row.query_source.trim(),
      campaign: (row.campaign || '').trim()
    }
  }
}

/**
 * Pure import planner: validates rows, skips place_ids already present.
 * DB insert is done by the caller (API / CLI) with the returned `toInsert` list.
 */
export function planLeadImport(
  rows: LeadCsvRow[],
  existingPlaceIds: Set<string>
): {
  toInsert: NormalizedLeadInput[]
  result: LeadImportResult
} {
  const failures: LeadImportFailure[] = []
  const toInsert: NormalizedLeadInput[] = []
  let duplicates = 0
  const batchSeen = new Set<string>()

  for (const row of rows) {
    const validated = validateLeadRow(row)
    if (!validated.ok) {
      failures.push(validated.failure)
      continue
    }
    const { lead } = validated
    if (existingPlaceIds.has(lead.placeId) || batchSeen.has(lead.placeId)) {
      duplicates += 1
      continue
    }
    batchSeen.add(lead.placeId)
    toInsert.push(lead)
  }

  return {
    toInsert,
    result: {
      imported: toInsert.length,
      duplicates,
      failed: failures.length,
      failures,
      importedIds: []
    }
  }
}

export function failuresToCsv(failures: LeadImportFailure[]): string {
  const header = 'line_number,business_name,phone,place_id,reason'
  const escape = (value: string) => `"${String(value || '').replaceAll('"', '""')}"`
  const lines = failures.map(
    f =>
      `${f.lineNumber},${escape(f.business_name)},${escape(f.phone)},${escape(f.place_id)},${escape(f.reason)}`
  )
  return [header, ...lines].join('\n')
}

export function e164FromStoredPhone(phone: string): string {
  const normalized = normalizeUsPhone(phone)
  if (normalized.ok) return `+1${normalized.digits}`
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone
}

/** Compatibility shim — live dials go through /api/leads/[id]/call + lib/telnyx. */
export async function triggerVoiceAgent(_lead: {
  id: string
  businessName: string
  phone: string
}): Promise<{ ok: true; stub: true } | { ok: false; error: string }> {
  if (String(process.env.DIALER_ENABLED || 'false').toLowerCase() !== 'true') {
    console.log('[triggerVoiceAgent] DIALER_ENABLED=false — no-op')
    return { ok: false, error: 'DIALER_ENABLED=false' }
  }
  return { ok: true, stub: true }
}

export function isCallableStatus(status: string): boolean {
  return status !== 'do_not_call'
}
