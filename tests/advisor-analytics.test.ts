import test from 'node:test'
import assert from 'node:assert/strict'
import { advisorPerformance, advisorPerformanceCompare, priorPeriod } from '../lib/advisorAnalytics'

test('priorPeriod is equal length ending day before from', () => {
  const range = priorPeriod('2026-09-01', '2026-09-30')
  assert.equal(range.from, '2026-08-02')
  assert.equal(range.to, '2026-08-31')
  assert.equal(range.days, 30)
})

test('advisor close rate uses approved dollars over recommended', () => {
  const orders = [
    {
      id: 'RO-1',
      advisor: 'Nora',
      completedAt: '2026-09-10',
      jobs: [
        { id: 'J1', laborHours: 1, laborRate: 100, partsPrice: 0, decision: 'Approved' },
        { id: 'J2', laborHours: 1, laborRate: 100, partsPrice: 0, decision: 'Declined' }
      ]
    },
    {
      id: 'RO-2',
      advisor: 'Sam',
      completedAt: '2026-09-12',
      jobs: [{ id: 'J3', laborHours: 2, laborRate: 100, partsPrice: 0, decision: 'Approved' }]
    }
  ]
  const rows = advisorPerformance(orders, '2026-09-01', '2026-09-30')
  const nora = rows.find(r => r.advisor === 'Nora')!
  const sam = rows.find(r => r.advisor === 'Sam')!
  assert.equal(nora.recommendedDollars, 200)
  assert.equal(nora.approvedDollars, 100)
  assert.equal(nora.closeRate, 50)
  assert.equal(sam.closeRate, 100)
  assert.equal(sam.aro, 200)
})

test('compare includes prior deltas', () => {
  const orders = [
    {
      id: 'RO-A',
      advisor: 'Nora',
      completedAt: '2026-09-10',
      jobs: [{ id: 'J1', laborHours: 1, laborRate: 100, partsPrice: 0, decision: 'Approved' }]
    },
    {
      id: 'RO-B',
      advisor: 'Nora',
      completedAt: '2026-08-10',
      jobs: [
        { id: 'J2', laborHours: 1, laborRate: 100, partsPrice: 0, decision: 'Approved' },
        { id: 'J3', laborHours: 1, laborRate: 100, partsPrice: 0, decision: 'Declined' }
      ]
    }
  ]
  const compare = advisorPerformanceCompare(orders, '2026-09-01', '2026-09-30')
  const nora = compare.rows.find(r => r.advisor === 'Nora')!
  assert.equal(nora.closeRate, 100)
  assert.equal(nora.priorCloseRate, 50)
  assert.equal(nora.closeRateDelta, 50)
})
