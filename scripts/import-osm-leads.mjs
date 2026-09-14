/**
 * Standalone OSM CSV → sales_leads import (no Next server-only deps).
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const postgres = require('postgres')

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const key = t.slice(0, i).trim()
      let value = t.slice(i + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const split = line => {
    const cells = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = !q
        continue
      }
      if (ch === ',' && !q) {
        cells.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    cells.push(cur.trim())
    return cells
  }
  const header = split(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''))
  const idx = name => header.indexOf(name)
  const bi = idx('business_name')
  const pi = idx('phone')
  const ai = idx('address')
  const wi = idx('website')
  const ri = idx('rating')
  const rci = idx('review_count')
  const pli = idx('place_id')
  const si = idx('query_source')
  const rows = []
  for (let n = 1; n < lines.length; n++) {
    const c = split(lines[n])
    rows.push({
      business_name: c[bi] || '',
      phone: c[pi] || '',
      address: c[ai] || '',
      website: wi >= 0 ? c[wi] || '' : '',
      rating: ri >= 0 ? c[ri] || '' : '',
      review_count: rci >= 0 ? c[rci] || '' : '',
      place_id: c[pli] || '',
      query_source: si >= 0 ? c[si] || '' : '',
      line: n + 1
    })
  }
  return rows
}

function normalizePhone(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  let digits = d
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  if (digits[0] < '2') return null
  return {
    digits,
    formatted: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
}

function leadId(shopId, placeId) {
  const safe = placeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
  return `LEAD-${shopId.slice(0, 8)}-${safe || Date.now()}`
}

async function main() {
  loadEnv()
  const shopId = process.env.LEADS_IMPORT_SHOP_ID?.trim()
  if (!shopId) throw new Error('LEADS_IMPORT_SHOP_ID missing')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing')

  const csvPath = join(process.cwd(), 'scripts', 'osm_auto_repair_leads.csv')
  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  console.log(`Parsed ${rows.length} CSV rows`)

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' })
  const campaign = 'osm-us-metros-sep2026'
  const now = Date.now()

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS sales_leads (
        id text PRIMARY KEY,
        shop_id text NOT NULL,
        business_name text NOT NULL,
        phone text NOT NULL,
        phone_digits text NOT NULL,
        address text NOT NULL DEFAULT '',
        website text,
        rating double precision,
        review_count integer,
        place_id text NOT NULL,
        source text NOT NULL DEFAULT '',
        campaign text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'new',
        notes text,
        attempts integer NOT NULL DEFAULT 0,
        retry_after bigint,
        created_at bigint NOT NULL,
        last_contacted_at bigint,
        updated_at bigint NOT NULL
      )
    `
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_shop_place_idx ON sales_leads(shop_id, place_id)`

    const existing = await sql`
      SELECT place_id FROM sales_leads WHERE shop_id = ${shopId}
    `
    const have = new Set(existing.map(r => r.place_id))

    let imported = 0
    let duplicates = 0
    let failed = 0

    for (const row of rows) {
      const placeId = row.place_id.trim()
      const name = row.business_name.trim()
      if (!placeId || !name) {
        failed++
        continue
      }
      if (have.has(placeId)) {
        duplicates++
        continue
      }
      const phone = normalizePhone(row.phone)
      if (!phone) {
        failed++
        continue
      }
      have.add(placeId)
      const id = leadId(shopId, placeId)
      const rating = row.rating ? Number(row.rating) : null
      const reviewCount = row.review_count ? Number(row.review_count) : null
      await sql`
        INSERT INTO sales_leads (
          id, shop_id, business_name, phone, phone_digits, address, website,
          rating, review_count, place_id, source, campaign, status, notes,
          attempts, retry_after, created_at, last_contacted_at, updated_at
        ) VALUES (
          ${id}, ${shopId}, ${name}, ${phone.formatted}, ${phone.digits},
          ${row.address || ''}, ${row.website || null},
          ${Number.isFinite(rating) ? rating : null},
          ${Number.isFinite(reviewCount) ? reviewCount : null},
          ${placeId}, ${row.query_source || 'osm'}, ${campaign}, 'new', null,
          0, null, ${now}, null, ${now}
        )
        ON CONFLICT DO NOTHING
      `
      imported++
    }

    await sql`
      CREATE TABLE IF NOT EXISTS sales_campaigns (
        id text PRIMARY KEY,
        shop_id text NOT NULL,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        total_leads integer NOT NULL DEFAULT 0,
        dialed integer NOT NULL DEFAULT 0,
        interested integer NOT NULL DEFAULT 0,
        converted integer NOT NULL DEFAULT 0,
        created_at bigint NOT NULL,
        started_at bigint,
        ended_at bigint,
        updated_at bigint NOT NULL
      )
    `

    const campId = `CMP-${shopId.slice(0, 6)}-osm-us-${String(now).slice(-4)}`
    await sql`
      INSERT INTO sales_campaigns (
        id, shop_id, name, status, total_leads, dialed, interested, converted,
        created_at, started_at, ended_at, updated_at
      ) VALUES (
        ${campId}, ${shopId}, ${campaign}, 'running', ${imported}, 0, 0, 0,
        ${now}, ${now}, null, ${now}
      )
      ON CONFLICT (id) DO NOTHING
    `

    const [total] = await sql`SELECT count(*)::int AS n FROM sales_leads WHERE shop_id = ${shopId}`
    console.log({ imported, duplicates, failed, campaign, campaignId: campId, totalLeads: total.n })
    console.log('DIALER stays OFF — review /leads then dry-run before live calls')
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
