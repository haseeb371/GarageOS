import assert from 'node:assert/strict'
import { buildFinancingOffer, financingConfigured, financingProvider } from '../lib/financing'
import { partsTechMode, searchPartsQuotes } from '../lib/partstech'

async function main() {
  assert.equal(financingConfigured(), true)
  assert.equal(financingProvider(), 'sandbox')
  const offer = buildFinancingOffer(1200, 'Demo Shop', 'INV-1', {
    baseUrl: 'http://localhost:3000',
    orderId: 'RO-1'
  })
  assert.ok(offer)
  assert.equal(offer?.sandbox, true)
  assert.ok(offer?.applyUrl.includes('/financing/demo'))
  assert.equal(buildFinancingOffer(100, 'Demo Shop', 'INV-1'), null)

  const quotes = await searchPartsQuotes('brake')
  assert.ok(quotes.length >= 1)
  assert.equal(partsTechMode(), 'sandbox')

  console.log('parity-remaining-four.test.ts: ok')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
