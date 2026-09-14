/**
 * Import OSM CSV into sales_leads for LEADS_IMPORT_SHOP_ID, assign campaign.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { and, count, eq } from 'drizzle-orm'
import { ensureSchema, db } from '../lib/db'
import { importLeadsFromCsvText } from '../lib/leadsImport'
import { salesLeads, salesCampaigns } from '../lib/schema'
import { assignLeadsToCampaign, startCampaign } from '../lib/dialer'

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eqPos = t.indexOf('=')
      if (eqPos <= 0) continue
      const key = t.slice(0, eqPos).trim()
      let value = t.slice(eqPos + 1).trim()
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

async function main() {
  loadEnv()
  await ensureSchema()
  const shopId = process.env.LEADS_IMPORT_SHOP_ID?.trim()
  if (!shopId) throw new Error('LEADS_IMPORT_SHOP_ID missing')

  const csvPath = join(process.cwd(), 'scripts', 'osm_auto_repair_leads.csv')
  const csv = readFileSync(csvPath, 'utf8')
  console.log('Importing', csvPath, 'into shop', shopId.slice(0, 8) + '…')

  const result = await importLeadsFromCsvText(csv, shopId, 'cli-osm-import')
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log(
    `Imported ${result.result.imported}, duplicates ${result.result.duplicates}, failed ${result.result.failed}`
  )
  console.log({
    imported: result.result.imported,
    duplicates: result.result.duplicates,
    failed: result.result.failed
  })

  const campaign = 'osm-us-metros-sep2026'
  // Assign all new OSM leads (source contains osm) that have empty campaign or this campaign
  const leads = await db
    .select({ id: salesLeads.id })
    .from(salesLeads)
    .where(and(eq(salesLeads.shopId, shopId), eq(salesLeads.status, 'new')))
  const ids = leads.map(l => l.id)
  if (ids.length) {
    await assignLeadsToCampaign(shopId, ids, campaign)
    console.log(`Assigned ${ids.length} new leads to campaign "${campaign}"`)
  }

  const started = await startCampaign(campaign, shopId)
  console.log('Campaign start:', started)

  const [total] = await db
    .select({ value: count() })
    .from(salesLeads)
    .where(eq(salesLeads.shopId, shopId))
  console.log('Total sales_leads for shop:', Number(total?.value || 0))

  const campaigns = await db
    .select()
    .from(salesCampaigns)
    .where(eq(salesCampaigns.shopId, shopId))
  console.log(
    'Campaigns:',
    campaigns.map(c => ({ name: c.name, status: c.status, total: c.totalLeads, dialed: c.dialed }))
  )

  console.log('\nDIALER_ENABLED stays false — no live calls yet.')
  console.log('Open /leads and /campaigns to review. Next: inbound test, then dry-run outbound.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
