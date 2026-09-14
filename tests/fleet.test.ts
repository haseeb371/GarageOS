import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFleetStatement, fleetStatementToCsv, isFleetCustomer } from '../lib/fleet'

test('isFleetCustomer detects flag, accountType, and tag', () => {
  assert.equal(isFleetCustomer({ id: '1', fleetAccount: true }), true)
  assert.equal(isFleetCustomer({ id: '2', accountType: 'Fleet' }), true)
  assert.equal(isFleetCustomer({ id: '3', tags: ['Fleet'] }), true)
  assert.equal(isFleetCustomer({ id: '4', tags: ['Retail'] }), false)
})

test('buildFleetStatement rolls invoices and payments', () => {
  const statement = buildFleetStatement({
    customer: { id: 'C-1', name: 'Fleet Co', poRequired: true, netTermsDays: 45 },
    invoices: [
      { id: 'INV-1', customerId: 'C-1', orderId: 'RO-1', total: 100, balance: 40, status: 'Partial', issuedAt: '2026-09-02', notes: 'Brakes' },
      { id: 'INV-2', customerId: 'C-1', orderId: 'RO-2', total: 50, balance: 50, status: 'Due', issuedAt: '2026-09-10' }
    ],
    payments: [{ id: 'P-1', invoiceId: 'INV-1', amount: 60, method: 'Check', status: 'Captured', date: '2026-09-05' }],
    orders: [
      { id: 'RO-1', customerId: 'C-1', vehicleId: 'V-1' },
      { id: 'RO-2', customerId: 'C-1', vehicleId: 'V-2' }
    ],
    vehicles: [
      { id: 'V-1', customerId: 'C-1', year: 2019, make: 'Ram', model: 'ProMaster' },
      { id: 'V-2', customerId: 'C-1', year: 2021, make: 'Ford', model: 'Transit' }
    ],
    from: '2026-09-01',
    to: '2026-09-30'
  })

  assert.equal(statement.lines.length, 3)
  assert.equal(statement.charges, 150)
  assert.equal(statement.payments, 60)
  assert.equal(statement.closing, 90)
  assert.equal(statement.openBalance, 90)
  assert.match(fleetStatementToCsv(statement), /INV-1/)
})
