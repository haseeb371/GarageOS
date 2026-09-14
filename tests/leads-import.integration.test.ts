/**
 * Import-endpoint style integration: same parse → plan → summary contract
 * used by POST /api/leads/import (without requiring a live database).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { failuresToCsv, parseLeadCsv, planLeadImport } from '../lib/leads'

const fixture = `business_name,phone,address,website,rating,review_count,place_id,query_source,date_pulled
Alpha Auto,+1 (512) 555-1212,1 Congress Ave Austin TX,https://alpha.example,4.6,88,ChIJ_ALPHA,auto repair shop in Austin TX,2026-09-11
Beta Brakes,512-555-1313,2 Congress Ave,,,,ChIJ_BETA,brake shop in Austin TX,2026-09-11
Alpha Auto Again,5125551212,1 Congress Ave,,,,ChIJ_ALPHA,auto repair shop in Austin TX,2026-09-11
Missing Phone,,3 Congress Ave,,,,ChIJ_GAMMA,query,2026-09-11
`

test('import endpoint pipeline summary matches fixture expectations', () => {
  const parsed = parseLeadCsv(fixture)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  // Simulate existing DB place_id for Beta.
  const planned = planLeadImport(parsed.rows, new Set(['ChIJ_BETA']))

  assert.equal(planned.result.imported, planned.toInsert.length)
  assert.equal(planned.toInsert.length, 1)
  assert.equal(planned.toInsert[0].placeId, 'ChIJ_ALPHA')
  assert.equal(planned.result.duplicates, 2) // existing Beta + in-file Alpha dup
  assert.equal(planned.result.failed, 1) // missing phone

  const report = failuresToCsv(planned.result.failures)
  assert.match(report, /Missing Phone/)
  assert.match(report, /Phone is required|phone/i)
})

test('sample queries file exists for Places puller', () => {
  const path = join(process.cwd(), 'scripts', 'queries.txt')
  const text = readFileSync(path, 'utf8')
  assert.match(text, /auto repair shop/)
})
