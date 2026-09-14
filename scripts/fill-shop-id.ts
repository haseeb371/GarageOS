/**
 * Local-only helpers: resolve LEADS_IMPORT_SHOP_ID from DB and print status.
 * Does not call Telnyx.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'

function loadEnvFile(name: string) {
  const path = join(process.cwd(), name)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function upsertEnvLocal(key: string, value: string) {
  const path = join(process.cwd(), '.env.local')
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = text.split(/\r?\n/)
  let found = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`^\\s*${key}\\s*=`))) {
      lines[i] = `${key}=${value}`
      found = true
      break
    }
  }
  if (!found) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push(`${key}=${value}`)
  }
  writeFileSync(path, lines.join('\n'), 'utf8')
}

async function main() {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL missing')
    process.exit(1)
  }
  if (process.env.LEADS_IMPORT_SHOP_ID?.trim()) {
    console.log('LEADS_IMPORT_SHOP_ID already set')
    return
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' })
  try {
    const rows = await sql<{ shop_id: string }[]>`
      SELECT shop_id FROM auth_users WHERE active = true ORDER BY created_at ASC LIMIT 1
    `
    const shopId = rows[0]?.shop_id
    if (!shopId) {
      console.log('No active auth_users shop_id found — skip')
      return
    }
    upsertEnvLocal('LEADS_IMPORT_SHOP_ID', shopId)
    console.log('SET LEADS_IMPORT_SHOP_ID from auth_users')
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
