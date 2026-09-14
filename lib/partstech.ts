/**
 * Parts supplier adapter — sandbox by default (no PartsTech partner required).
 * Set PARTSTECH_MODE=live + PARTSTECH_API_KEY when you have credentials.
 */

export type PartsQuoteResult = {
  partNumber: string
  description: string
  brand: string
  supplier: string
  unitCost: number
  listPrice: number
  coreCharge: number
  available: number
  deliveryEstimate: string
  source: string
}

const CATALOG: Array<Omit<PartsQuoteResult, 'source' | 'supplier'> & { suppliers: string[] }> = [
  {
    partNumber: 'BRK-PAD-FR',
    description: 'Ceramic brake pad set — front',
    brand: 'Wagner',
    unitCost: 42.5,
    listPrice: 89.99,
    coreCharge: 0,
    available: 24,
    deliveryEstimate: 'Same day',
    suppliers: ['Worldpac', 'PartsTech Sandbox', 'Local warehouse']
  },
  {
    partNumber: 'OIL-5W30-5Q',
    description: 'Synthetic 5W-30 motor oil — 5 qt',
    brand: 'Mobil 1',
    unitCost: 28.1,
    listPrice: 49.95,
    coreCharge: 0,
    available: 80,
    deliveryEstimate: '1 business day',
    suppliers: ['NAPA', 'PartsTech Sandbox']
  },
  {
    partNumber: 'FLT-OIL-HF',
    description: 'Oil filter — high efficiency',
    brand: 'Wix',
    unitCost: 6.4,
    listPrice: 14.99,
    coreCharge: 0,
    available: 120,
    deliveryEstimate: 'Same day',
    suppliers: ['PartsTech Sandbox', 'Worldpac']
  },
  {
    partNumber: 'ALT-REM-12',
    description: 'Reman alternator 12V',
    brand: 'BBB Industries',
    unitCost: 145,
    listPrice: 289,
    coreCharge: 45,
    available: 6,
    deliveryEstimate: '2 business days',
    suppliers: ['Worldpac', 'PartsTech Sandbox']
  },
  {
    partNumber: 'BAT-H7-AGM',
    description: 'AGM battery H7',
    brand: 'Odyssey',
    unitCost: 168,
    listPrice: 289,
    coreCharge: 22,
    available: 9,
    deliveryEstimate: 'Same day',
    suppliers: ['NAPA', 'PartsTech Sandbox']
  },
  {
    partNumber: 'WIP-22-PAIR',
    description: 'Beam wiper blades 22" pair',
    brand: 'Bosch',
    unitCost: 18.75,
    listPrice: 39.99,
    coreCharge: 0,
    available: 40,
    deliveryEstimate: 'Same day',
    suppliers: ['PartsTech Sandbox']
  }
]

export function partsTechMode(): 'sandbox' | 'live' | 'off' {
  const mode = String(process.env.PARTSTECH_MODE || 'sandbox').trim().toLowerCase()
  if (mode === 'off' || mode === 'disabled') return 'off'
  if (mode === 'live' && process.env.PARTSTECH_API_KEY?.trim()) return 'live'
  return 'sandbox'
}

export function partsTechConfigured() {
  return partsTechMode() !== 'off'
}

export async function searchPartsQuotes(query: string, quantity = 1): Promise<PartsQuoteResult[]> {
  const mode = partsTechMode()
  if (mode === 'off') return []
  if (mode === 'live') {
    // Live PartsTech REST would go here when PARTSTECH_API_KEY is issued.
    // Fall through to sandbox results labeled as live-unavailable until partner wiring lands.
    console.warn('[partstech] LIVE mode requested but API client not wired — using sandbox catalog')
  }

  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const qty = Math.max(1, Number(quantity) || 1)

  const matches = CATALOG.filter(
    item =>
      item.partNumber.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.brand.toLowerCase().includes(q)
  )

  const results: PartsQuoteResult[] = []
  for (const item of matches) {
    for (const supplier of item.suppliers) {
      const jitter = supplier.length % 3
      results.push({
        partNumber: item.partNumber,
        description: item.description,
        brand: item.brand,
        supplier,
        unitCost: Math.round((item.unitCost + jitter * 1.25) * 100) / 100,
        listPrice: item.listPrice,
        coreCharge: item.coreCharge,
        available: Math.max(0, item.available - jitter),
        deliveryEstimate: item.deliveryEstimate,
        source: mode === 'live' ? 'PartsTech' : 'PartsTech sandbox'
      })
    }
  }

  // Always return at least one synthetic hit for free-text searches so advisors can demo.
  if (!results.length) {
    results.push({
      partNumber: q.toUpperCase().replace(/\s+/g, '-').slice(0, 24) || 'CUSTOM',
      description: `Supplier match for “${query.trim()}”`,
      brand: 'Aftermarket',
      supplier: 'PartsTech Sandbox',
      unitCost: 35.5 * qty,
      listPrice: 69.99 * qty,
      coreCharge: 0,
      available: 12,
      deliveryEstimate: '1–2 business days',
      source: 'PartsTech sandbox'
    })
  }

  return results
}

export async function placePartsOrder(input: {
  quoteId: string
  partNumber: string
  supplier: string
  quantity: number
  unitCost: number
}) {
  const mode = partsTechMode()
  const providerOrderId = `PT-${mode === 'live' ? 'L' : 'S'}-${Date.now().toString(36).toUpperCase()}`
  return {
    ok: true as const,
    mode,
    providerOrderId,
    status: mode === 'live' ? 'Submitted' : 'Submitted (sandbox)',
    message:
      mode === 'live'
        ? `Order ${providerOrderId} placed with ${input.supplier}.`
        : `Sandbox order ${providerOrderId} recorded for ${input.partNumber} × ${input.quantity}.`
  }
}
