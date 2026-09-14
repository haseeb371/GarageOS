import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeUsPhone,
  parseLeadCsv,
  planLeadImport,
  type LeadCsvRow
} from '../lib/leads'

test('normalizeUsPhone accepts common US formats', () => {
  const cases = [
    ['5551234567', '(555) 123-4567', '5551234567'],
    ['(555) 123-4567', '(555) 123-4567', '5551234567'],
    ['555-123-4567', '(555) 123-4567', '5551234567'],
    ['+1 555 123 4567', '(555) 123-4567', '5551234567'],
    ['1-555-123-4567', '(555) 123-4567', '5551234567']
  ] as const

  for (const [input, formatted, digits] of cases) {
    const result = normalizeUsPhone(input)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.formatted, formatted)
      assert.equal(result.digits, digits)
    }
  }
})

test('normalizeUsPhone rejects invalid phones', () => {
  assert.equal(normalizeUsPhone('').ok, false)
  assert.equal(normalizeUsPhone('12345').ok, false)
  assert.equal(normalizeUsPhone('0551234567').ok, false)
  assert.equal(normalizeUsPhone('1551234567').ok, false)
})

test('planLeadImport skips duplicate place_id', () => {
  const rows: LeadCsvRow[] = [
    {
      business_name: 'A Shop',
      phone: '5551234567',
      address: '1 Main St',
      website: '',
      rating: '4.5',
      review_count: '10',
      place_id: 'ChIJ_EXISTING',
      query_source: 'auto repair shop in Houston TX',
      date_pulled: '2026-09-11',
      lineNumber: 2
    },
    {
      business_name: 'B Shop',
      phone: '5559876543',
      address: '2 Main St',
      website: '',
      rating: '4.1',
      review_count: '3',
      place_id: 'ChIJ_NEW',
      query_source: 'mechanic in Phoenix AZ',
      date_pulled: '2026-09-11',
      lineNumber: 3
    },
    {
      business_name: 'C Shop',
      phone: '5551112222',
      address: '3 Main St',
      website: '',
      rating: '',
      review_count: '',
      place_id: 'ChIJ_NEW',
      query_source: 'dup in file',
      date_pulled: '2026-09-11',
      lineNumber: 4
    }
  ]

  const planned = planLeadImport(rows, new Set(['ChIJ_EXISTING']))
  assert.equal(planned.toInsert.length, 1)
  assert.equal(planned.toInsert[0].placeId, 'ChIJ_NEW')
  assert.equal(planned.result.duplicates, 2)
  assert.equal(planned.result.failed, 0)
})

test('parseLeadCsv + planLeadImport integration on fixture CSV', () => {
  const csv = `business_name,phone,address,website,rating,review_count,place_id,query_source,date_pulled
Good Garage,(713) 555-0100,"100 Main St, Houston, TX",https://example.com,4.8,120,ChIJ_A,auto repair shop in Houston TX,2026-09-11
Bad Phone,123,Anywhere,,,,ChIJ_B,query,2026-09-11
Dup Garage,7135550199,Addr,,,,ChIJ_A,query,2026-09-11
No Place,(713) 555-0101,Addr,,,,,query,2026-09-11
`

  const parsed = parseLeadCsv(csv)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  const planned = planLeadImport(parsed.rows, new Set())
  assert.equal(planned.toInsert.length, 1)
  assert.equal(planned.toInsert[0].businessName, 'Good Garage')
  assert.equal(planned.toInsert[0].phone, '(713) 555-0100')
  assert.equal(planned.result.duplicates, 1)
  assert.ok(planned.result.failed >= 2)
})
