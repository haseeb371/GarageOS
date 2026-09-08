const fs = require('fs')
const postgres = require('postgres')

function loadEnv() {
  const raw = fs.readFileSync('.env.local', 'utf8')
  const db = raw.match(/^DATABASE_URL=(.*)$/m)
  if (!db) throw new Error('DATABASE_URL missing')
  const webhook = raw.match(/^ACCOUNTING_WEBHOOK_URL=(.*)$/m)
  const provider = raw.match(/^ACCOUNTING_PROVIDER=(.*)$/m)
  return {
    url: db[1].trim().replace(/^["']|["']$/g, ''),
    webhook: webhook ? webhook[1].trim().replace(/^["']|["']$/g, '') : '',
    provider: provider ? provider[1].trim().replace(/^["']|["']$/g, '') : ''
  }
}

async function main() {
  const env = loadEnv()
  console.log('ACCOUNTING_PROVIDER=', env.provider || '(empty)')
  if (!env.webhook) {
    console.log('ACCOUNTING_WEBHOOK_URL is EMPTY')
  } else {
    let host = '(unparseable)'
    try {
      const u = new URL(env.webhook)
      host = u.host
      console.log('Webhook host=', host)
      console.log('Looks like Zapier catch hook=', host.includes('hooks.zapier.com') && u.pathname.includes('/hooks/catch/'))
    } catch {
      console.log('Webhook URL is not a valid URL')
    }
  }

  const sql = postgres(env.url, { max: 1, prepare: false, ssl: 'require' })
  const owners = await sql`
    SELECT id, shop_id, email, name, role FROM auth_users
    WHERE active = true AND role = 'Owner'
    ORDER BY updated_at DESC LIMIT 5
  `
  console.log('Owners:', owners.map(o => ({ name: o.name, shopId: o.shop_id, email: o.email })))

  if (!owners.length) throw new Error('No owner user found')
  const preferred =
    owners.find(o => String(o.email || '').toLowerCase().includes('haseeb')) ||
    owners.find(o => String(o.name || '').toLowerCase().includes('haseeb')) ||
    owners[0]
  const shopId = preferred.shop_id
  console.log('Using owner:', preferred.name, preferred.email)

  let customers = await sql`SELECT id FROM records WHERE kind = 'customers' AND shop_id = ${shopId} LIMIT 1`
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  if (!customers.length) {
    const customerId = `C-SYNC-${String(now).slice(-5)}`
    await sql`
      INSERT INTO records (id, kind, shop_id, data, created_at, updated_at)
      VALUES (
        ${customerId}, 'customers', ${shopId},
        ${JSON.stringify({
          id: customerId,
          name: 'Accounting Sync Test Customer',
          phone: '',
          email: 'sync-test@example.com',
          credit: 0,
          tags: ['Retail'],
          notes: 'Zapier webhook test',
          shopId
        })},
        ${now}, ${now}
      )
    `
    customers = [{ id: customerId }]
  }

  const invoiceId = `INV-SYNC-${String(now).slice(-5)}`
  const paymentId = `P-SYNC-${String(now).slice(-5)}`
  const total = 250
  const customerId = customers[0].id

  await sql`
    INSERT INTO records (id, kind, shop_id, data, created_at, updated_at)
    VALUES (
      ${invoiceId}, 'invoices', ${shopId},
      ${JSON.stringify({
        id: invoiceId,
        orderId: '',
        customerId,
        total,
        balance: 0,
        status: 'Paid',
        due: today,
        issuedAt: today,
        notes: 'Test invoice for accounting webhook sync',
        shopId
      })},
      ${now}, ${now}
    )
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `

  await sql`
    INSERT INTO records (id, kind, shop_id, data, created_at, updated_at)
    VALUES (
      ${paymentId}, 'payments', ${shopId},
      ${JSON.stringify({
        id: paymentId,
        invoiceId,
        amount: total,
        method: 'Card',
        status: 'Captured',
        date: today,
        reference: 'Zapier sync test',
        shopId
      })},
      ${now}, ${now}
    )
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
  `

  const invCount = await sql`
    SELECT count(*)::int AS n FROM records
    WHERE kind = 'invoices' AND shop_id = ${shopId}
  `
  console.log('Shop', shopId)
  console.log('Created', invoiceId, paymentId, 'date', today)
  console.log('Invoice count for shop=', invCount[0].n)
  await sql.end({ timeout: 5 })
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
