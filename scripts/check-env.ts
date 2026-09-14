/**
 * Prints set/missing status for every AI calling env var.
 * Loads .env.local / .env into process.env first (does not override existing env).
 * Usage: npx tsx scripts/check-env.ts
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ENV_CATALOG, loadConfig, resetConfigWarnForTests } from '../lib/config'

function loadEnvFile(name: string) {
  const path = join(process.cwd(), name)
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
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
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

function pad(s: string, n: number) {
  return (s + ' '.repeat(n)).slice(0, n)
}

function main() {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  resetConfigWarnForTests()

  const cfg = loadConfig()
  console.log('\nAutoGaragify AI calling env check\n')
  console.log(`${pad('KEY', 28)} ${pad('STATUS', 10)} ${pad('DEFAULT', 10)} NOTE`)
  console.log('-'.repeat(90))
  for (const row of ENV_CATALOG) {
    let set = false
    switch (row.key) {
      case 'TELNYX_API_KEY':
        set = Boolean(cfg.TELNYX_API_KEY)
        break
      case 'TELNYX_CONNECTION_ID':
        set = Boolean(cfg.TELNYX_CONNECTION_ID)
        break
      case 'TELNYX_FROM_NUMBER':
        set = Boolean(cfg.TELNYX_FROM_NUMBER)
        break
      case 'TELNYX_PUBLIC_KEY':
        set = Boolean(cfg.TELNYX_PUBLIC_KEY)
        break
      case 'TELNYX_ASSISTANT_ID':
        set = Boolean(cfg.TELNYX_ASSISTANT_ID)
        break
      case 'SALES_TRANSFER_NUMBER':
        set = Boolean(cfg.SALES_TRANSFER_NUMBER)
        break
      case 'DIALER_ENABLED':
        set = process.env.DIALER_ENABLED !== undefined && process.env.DIALER_ENABLED !== ''
        break
      case 'DIALER_MAX_CONCURRENT':
        set = process.env.DIALER_MAX_CONCURRENT !== undefined && process.env.DIALER_MAX_CONCURRENT !== ''
        break
      case 'DIALER_DAILY_CAP':
        set = process.env.DIALER_DAILY_CAP !== undefined && process.env.DIALER_DAILY_CAP !== ''
        break
      case 'DIALER_DRY_RUN':
        set = process.env.DIALER_DRY_RUN !== undefined && process.env.DIALER_DRY_RUN !== ''
        break
      case 'US_STATE_BLOCKLIST':
        set = process.env.US_STATE_BLOCKLIST !== undefined
        break
      case 'CRON_SECRET':
        set = Boolean(cfg.CRON_SECRET)
        break
      case 'LEADS_IMPORT_SHOP_ID':
        set = Boolean(cfg.LEADS_IMPORT_SHOP_ID)
        break
      case 'SLACK_WEBHOOK_URL':
        set = Boolean(cfg.SLACK_WEBHOOK_URL)
        break
      case 'AI_PROMPT_VERSION':
        set = process.env.AI_PROMPT_VERSION !== undefined && process.env.AI_PROMPT_VERSION !== ''
        break
      default:
        set = Boolean(process.env[row.key])
    }
    const status = set ? 'set' : row.required ? 'MISSING' : 'unset'
    console.log(
      `${pad(row.key, 28)} ${pad(status, 10)} ${pad(row.defaultValue || '—', 10)} ${row.note}`
    )
  }
  console.log('')
}

main()
