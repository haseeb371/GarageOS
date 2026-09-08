type Row = Record<string, unknown> & { id: string }

export function shopReviewLinks(shop?: Row | null) {
  return {
    google: String(shop?.googleReviewUrl || '').trim(),
    yelp: String(shop?.yelpReviewUrl || '').trim()
  }
}

export function preferredReviewUrl(shop?: Row | null, platform: 'google' | 'yelp' | 'auto' = 'auto') {
  const links = shopReviewLinks(shop)
  if (platform === 'google') return links.google
  if (platform === 'yelp') return links.yelp
  return links.google || links.yelp
}

export function buildReviewRequestMessage(input: {
  customerName: string
  shopName: string
  reviewUrl: string
  platform?: string
}) {
  const platform = input.platform || 'Google'
  return `Hi ${input.customerName || 'there'}, thanks for choosing ${input.shopName || 'us'}! If you have a minute, please leave a ${platform} review: ${input.reviewUrl}`
}

export function reviewCsvTemplate() {
  return [
    'customer,rating,text,source,status,response,reviewedAt',
    '"Alex Rivera",5,"Great inspection and clear updates.",Google,"Imported","",2026-08-01',
    '"Sam Lee",4,"Solid work on the brakes.",Yelp,"Imported","Thanks for visiting us!",2026-08-03'
  ].join('\n')
}

function splitCsvLine(line: string) {
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

export type ImportedReview = {
  customer: string
  rating: number
  text: string
  source: string
  status: string
  response: string
  reviewedAt: string
}

export function parseReviewCsv(csv: string) {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return { ok: false as const, error: 'CSV needs a header row and at least one review.', rows: [] as ImportedReview[] }
  }

  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const customerIdx = idx(['customer', 'customername', 'name', 'author'])
  const ratingIdx = idx(['rating', 'stars', 'score'])
  const textIdx = idx(['text', 'review', 'body', 'comment'])
  const sourceIdx = idx(['source', 'platform', 'site'])
  const statusIdx = idx(['status'])
  const responseIdx = idx(['response', 'reply'])
  const dateIdx = idx(['reviewedat', 'date', 'createdat'])

  if (customerIdx < 0 || ratingIdx < 0 || textIdx < 0) {
    return {
      ok: false as const,
      error: 'CSV header must include customer, rating, and text columns.',
      rows: [] as ImportedReview[]
    }
  }

  const rows: ImportedReview[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const rating = Number(cells[ratingIdx] || 0)
    const customer = cells[customerIdx] || ''
    const text = cells[textIdx] || ''
    if (!customer || !text || !Number.isFinite(rating) || rating < 1 || rating > 5) continue
    rows.push({
      customer,
      rating: Math.round(rating),
      text,
      source: sourceIdx >= 0 ? cells[sourceIdx] || 'Imported' : 'Imported',
      status: statusIdx >= 0 ? cells[statusIdx] || 'Imported' : 'Imported',
      response: responseIdx >= 0 ? cells[responseIdx] || '' : '',
      reviewedAt: dateIdx >= 0 ? cells[dateIdx] || new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
    })
  }

  if (!rows.length) return { ok: false as const, error: 'No valid review rows found.', rows: [] as ImportedReview[] }
  return { ok: true as const, rows }
}

export function reviewRecordsFromImport(rows: ImportedReview[], shopId: string, customers: Row[] = []) {
  const stamp = Date.now()
  return rows.map((row, index) => {
    const match = customers.find(c => String(c.name || '').toLowerCase() === row.customer.toLowerCase())
    const id = `RV-${String(stamp).slice(-6)}-${index + 1}`
    return {
      id,
      customerId: match?.id || '',
      customer: row.customer,
      rating: row.rating,
      text: row.text,
      source: row.source,
      status: row.status || 'Imported',
      response: row.response,
      reviewedAt: row.reviewedAt,
      shopId
    } satisfies Row
  })
}

export function completedCustomersForReviewRequest(orders: Row[] = [], customers: Row[] = [], reviews: Row[] = []) {
  const recent = orders
    .filter(order => String(order.status) === 'Completed')
    .map(order => String(order.customerId || ''))
    .filter(Boolean)
  const unique = [...new Set(recent)]
  return unique
    .map(customerId => customers.find(c => c.id === customerId))
    .filter((c): c is Row => Boolean(c))
    .filter(c => !reviews.some(r => r.customerId === c.id && String(r.status || '').toLowerCase().includes('request')))
}
