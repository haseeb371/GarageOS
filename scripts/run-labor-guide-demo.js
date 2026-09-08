const fs = require('fs')
const postgres = require('postgres')
const path = require('path')

// Inline reference pack (mirrors lib/laborGuide.ts) so this script runs without TS compile
const LABOR_REFERENCE_PACK = [
  { operation: 'Engine oil and filter service', system: 'Lube', standardHours: 0.5, warrantyHours: 0.4, notes: 'Includes drain, filter, refill, reset reminder if equipped.' },
  { operation: 'Rotate and balance four tires', system: 'Tires', standardHours: 1.0, warrantyHours: 0.8, notes: 'Road-force balance if shop equipped.' },
  { operation: 'Replace cabin air filter', system: 'HVAC', standardHours: 0.4, warrantyHours: 0.3, notes: '' },
  { operation: 'Replace engine air filter', system: 'Engine', standardHours: 0.3, warrantyHours: 0.2, notes: '' },
  { operation: 'Front brake pads and rotors', system: 'Brakes', standardHours: 2.2, warrantyHours: 1.8, notes: 'Both sides; verify ABS tone rings.' },
  { operation: 'Rear brake pads and rotors', system: 'Brakes', standardHours: 2.0, warrantyHours: 1.6, notes: '' },
  { operation: 'Brake fluid exchange', system: 'Brakes', standardHours: 1.0, warrantyHours: 0.8, notes: '' },
  { operation: 'Battery test and replacement', system: 'Electrical', standardHours: 0.6, warrantyHours: 0.5, notes: '' },
  { operation: 'Alternator replacement', system: 'Electrical', standardHours: 2.5, warrantyHours: 2.0, notes: '' },
  { operation: 'Starter replacement', system: 'Electrical', standardHours: 2.0, warrantyHours: 1.6, notes: '' },
  { operation: 'Spark plugs (4-cylinder)', system: 'Ignition', standardHours: 1.2, warrantyHours: 1.0, notes: '' },
  { operation: 'Spark plugs (V6)', system: 'Ignition', standardHours: 2.0, warrantyHours: 1.6, notes: '' },
  { operation: 'Coolant system flush', system: 'Cooling', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'Thermostat replacement', system: 'Cooling', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'Water pump replacement', system: 'Cooling', standardHours: 3.5, warrantyHours: 2.8, notes: '' },
  { operation: 'Serpentine belt replacement', system: 'Engine', standardHours: 0.8, warrantyHours: 0.6, notes: '' },
  { operation: 'Timing belt service', system: 'Engine', standardHours: 6.0, warrantyHours: 5.0, notes: '' },
  { operation: 'Transmission fluid service', system: 'Drivetrain', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'Four-wheel alignment', system: 'Steering', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'Front strut assembly (one side)', system: 'Suspension', standardHours: 1.8, warrantyHours: 1.5, notes: '' },
  { operation: 'Wheel bearing hub (one side)', system: 'Suspension', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'A/C performance check and recharge', system: 'HVAC', standardHours: 1.2, warrantyHours: 1.0, notes: '' },
  { operation: 'Diagnostic / check engine light', system: 'Diagnostics', standardHours: 1.0, warrantyHours: 0.8, notes: '' },
  { operation: 'Pre-purchase inspection', system: 'Inspection', standardHours: 1.5, warrantyHours: 1.2, notes: '' }
]

function loadDbUrl() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
  const m = raw.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error('DATABASE_URL missing')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const sql = postgres(loadDbUrl(), { max: 1, prepare: false, ssl: 'require' })
  const owners = await sql`
    SELECT shop_id, email, name FROM auth_users
    WHERE active = true AND role = 'Owner'
  `
  const owner =
    owners.find(o => String(o.email || '').includes('haseeb')) ||
    owners.find(o => String(o.name || '').toLowerCase().includes('haseeb')) ||
    owners[0]
  if (!owner) throw new Error('No owner found')
  const shopId = owner.shop_id
  console.log('Shop:', shopId, '·', owner.name)

  // Clear prior reference-pack imports for a clean demo (keep shop-authored)
  await sql`
    DELETE FROM records
    WHERE shop_id = ${shopId}
      AND kind = 'laborGuideEntries'
      AND data::text LIKE '%AutoGaragify reference pack%'
  `

  const stamp = Date.now()
  const entries = LABOR_REFERENCE_PACK.map((t, index) => {
    const id = `LG-${String(stamp).slice(-6)}-${index + 1}`
    return {
      id,
      kind: 'laborGuideEntries',
      data: {
        id,
        vehicleId: '',
        operation: t.operation,
        system: t.system,
        standardHours: t.standardHours,
        warrantyHours: t.warrantyHours,
        source: 'AutoGaragify reference pack',
        sourceReference: 'Sandbox — not licensed MOTOR/AllData data',
        notes: t.notes,
        shopId
      }
    }
  })

  for (const entry of entries) {
    await sql`
      INSERT INTO records (id, kind, shop_id, data, created_at, updated_at)
      VALUES (${entry.id}, ${entry.kind}, ${shopId}, ${JSON.stringify(entry.data)}, ${stamp}, ${stamp})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `
  }
  console.log('Loaded reference pack:', entries.length, 'operations')

  // Labor rate from pricing rules
  const rules = await sql`
    SELECT data FROM records WHERE shop_id = ${shopId} AND kind = 'pricingRules'
  `
  let laborRate = 140
  for (const row of rules) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    if (d.type === 'Labor rate' && d.active !== false) laborRate = Number(d.amount || laborRate)
  }

  // Find or create an open RO
  const orderRows = await sql`
    SELECT id, data FROM records
    WHERE shop_id = ${shopId} AND kind = 'orders'
    ORDER BY updated_at DESC
  `
  let order = null
  for (const row of orderRows) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    if (String(d.status) !== 'Completed') {
      order = d
      break
    }
  }

  if (!order) {
    const customers = await sql`SELECT id, data FROM records WHERE shop_id = ${shopId} AND kind = 'customers' LIMIT 1`
    const vehicles = await sql`SELECT id, data FROM records WHERE shop_id = ${shopId} AND kind = 'vehicles' LIMIT 1`
    if (!customers.length) throw new Error('No customers — create one in the UI first')
    const customerId = customers[0].id
    const vehicleId = vehicles[0]?.id || ''
    const id = `RO-${String(stamp).slice(-4)}`
    order = {
      id,
      customerId,
      vehicleId,
      locationId: '',
      status: 'Estimate',
      advisor: owner.name,
      technician: 'Unassigned',
      taxRate: 8.25,
      discount: 0,
      fees: 0,
      jobs: [],
      authorizations: [],
      shopId
    }
    await sql`
      INSERT INTO records (id, kind, shop_id, data, created_at, updated_at)
      VALUES (${id}, 'orders', ${shopId}, ${JSON.stringify(order)}, ${stamp}, ${stamp})
    `
    console.log('Created open RO:', id)
  } else {
    console.log('Using open RO:', order.id, 'status=', order.status)
  }

  const guide = entries.find(e => e.data.operation === 'Front brake pads and rotors') || entries[0]
  const job = {
    id: `J-${stamp}`,
    type: guide.data.system,
    name: guide.data.operation,
    description: guide.data.notes || `Labor guide · ${guide.data.source}`,
    laborHours: guide.data.standardHours,
    laborRate,
    partsCost: 0,
    partsPrice: 0,
    decision: 'Pending',
    severity: 'Standard',
    laborGuideId: guide.id,
    source: guide.data.source
  }

  const jobs = Array.isArray(order.jobs) ? [...order.jobs] : []
  // Avoid duplicate same laborGuideId
  if (!jobs.some(j => j.laborGuideId === guide.id)) jobs.push(job)
  order = { ...order, jobs }

  await sql`
    UPDATE records
    SET data = ${JSON.stringify(order)}, updated_at = ${Date.now()}
    WHERE id = ${order.id} AND shop_id = ${shopId}
  `

  // Mark MOTOR adapter Ready
  const integrations = await sql`
    SELECT id, data FROM records WHERE shop_id = ${shopId} AND kind = 'integrations'
  `
  for (const row of integrations) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    if (String(d.name || '').toLowerCase().includes('motor')) {
      await sql`
        UPDATE records SET data = ${JSON.stringify({
          ...d,
          mode: 'Sandbox pack',
          status: 'Ready',
          notes: `Last import: ${entries.length} labor operations (AutoGaragify reference pack).`
        })}, updated_at = ${Date.now()}
        WHERE id = ${row.id}
      `
    }
  }

  console.log('Added job to RO:', job.name)
  console.log(`  ${job.laborHours}h × $${laborRate}/hr = $${(job.laborHours * laborRate).toFixed(2)}`)
  console.log('Done. Refresh Labor & vehicle data / Repair orders in the browser.')
  await sql.end({ timeout: 5 })
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
