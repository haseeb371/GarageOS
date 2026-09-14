import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Typed AI-calling / Telnyx env config.
 * Missing required vars log a single warning — never throw.
 */

export type AiCallingConfig = {
  TELNYX_API_KEY: string
  TELNYX_CONNECTION_ID: string
  TELNYX_FROM_NUMBER: string
  TELNYX_PUBLIC_KEY: string
  TELNYX_ASSISTANT_ID: string
  SALES_TRANSFER_NUMBER: string
  DIALER_ENABLED: boolean
  DIALER_MAX_CONCURRENT: number
  DIALER_DAILY_CAP: number
  DIALER_DRY_RUN: boolean
  US_STATE_BLOCKLIST: string[]
  CRON_SECRET: string
  LEADS_IMPORT_SHOP_ID: string
  SLACK_WEBHOOK_URL: string
  AI_PROMPT_VERSION: string
}

const REQUIRED_FOR_LIVE = [
  'TELNYX_API_KEY',
  'TELNYX_CONNECTION_ID',
  'TELNYX_FROM_NUMBER',
  'TELNYX_PUBLIC_KEY',
  'TELNYX_ASSISTANT_ID',
  'CRON_SECRET',
  'LEADS_IMPORT_SHOP_ID'
] as const

/** Runtime overrides (admin prompt activation, in-process only). */
const runtimeOverrides: Partial<{ AI_PROMPT_VERSION: string; US_STATE_BLOCKLIST: string }> = {}

let warnedMissing = false

function truthy(value: string | undefined, defaultFalse = true) {
  if (value === undefined || value === '') return !defaultFalse ? false : false
  return String(value).toLowerCase() === 'true'
}

function num(value: string | undefined, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseStates(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
}

export function setRuntimeConfig(patch: Partial<{ AI_PROMPT_VERSION: string; US_STATE_BLOCKLIST: string }>) {
  Object.assign(runtimeOverrides, patch)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AiCallingConfig {
  const fromNumber =
    env.TELNYX_FROM_NUMBER?.trim() || env.TELNYX_PHONE_NUMBER?.trim() || ''
  const promptVersion =
    runtimeOverrides.AI_PROMPT_VERSION || env.AI_PROMPT_VERSION?.trim() || 'v1'
  const blockRaw =
    runtimeOverrides.US_STATE_BLOCKLIST !== undefined
      ? runtimeOverrides.US_STATE_BLOCKLIST
      : (() => {
          const file = join(process.cwd(), 'prompts', '.state-blocklist')
          if (existsSync(file)) {
            try {
              return readFileSync(file, 'utf8').trim()
            } catch {
              /* fall through */
            }
          }
          return env.US_STATE_BLOCKLIST
        })()

  const config: AiCallingConfig = {
    TELNYX_API_KEY: env.TELNYX_API_KEY?.trim() || '',
    TELNYX_CONNECTION_ID: env.TELNYX_CONNECTION_ID?.trim() || '',
    TELNYX_FROM_NUMBER: fromNumber,
    TELNYX_PUBLIC_KEY: env.TELNYX_PUBLIC_KEY?.trim() || '',
    TELNYX_ASSISTANT_ID: env.TELNYX_ASSISTANT_ID?.trim() || '',
    SALES_TRANSFER_NUMBER: env.SALES_TRANSFER_NUMBER?.trim() || '',
    DIALER_ENABLED: String(env.DIALER_ENABLED || 'false').toLowerCase() === 'true',
    DIALER_MAX_CONCURRENT: num(env.DIALER_MAX_CONCURRENT, 5),
    DIALER_DAILY_CAP: num(env.DIALER_DAILY_CAP, 20),
    DIALER_DRY_RUN: String(env.DIALER_DRY_RUN || 'false').toLowerCase() === 'true',
    US_STATE_BLOCKLIST: parseStates(blockRaw),
    CRON_SECRET: env.CRON_SECRET?.trim() || '',
    LEADS_IMPORT_SHOP_ID: env.LEADS_IMPORT_SHOP_ID?.trim() || env.TELNYX_SHOP_ID?.trim() || '',
    SLACK_WEBHOOK_URL: env.SLACK_WEBHOOK_URL?.trim() || '',
    AI_PROMPT_VERSION: promptVersion || 'v1'
  }

  if (!warnedMissing) {
    const missing = REQUIRED_FOR_LIVE.filter(k => {
      if (k === 'TELNYX_FROM_NUMBER') return !config.TELNYX_FROM_NUMBER
      return !(config as Record<string, unknown>)[k]
    })
    if (missing.length) {
      console.warn(`[config] Missing AI calling env vars (non-fatal): ${missing.join(', ')}`)
    }
    warnedMissing = true
  }

  return config
}

/** Cached snapshot refreshed on each call so runtime overrides apply. */
export function getConfig() {
  return loadConfig()
}

export function isDialerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(env).DIALER_ENABLED
}

export function isDryRun(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(env).DIALER_DRY_RUN
}

export function getBlockedStates(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(env).US_STATE_BLOCKLIST
}

export function resetConfigWarnForTests() {
  warnedMissing = false
}

export function clearRuntimeOverridesForTests() {
  for (const k of Object.keys(runtimeOverrides) as Array<keyof typeof runtimeOverrides>) {
    delete runtimeOverrides[k]
  }
}

/** Env var catalog for check-env / docs. */
export const ENV_CATALOG: Array<{ key: string; required: boolean; defaultValue: string; note: string }> = [
  { key: 'TELNYX_API_KEY', required: true, defaultValue: '', note: 'Telnyx Mission Control API key' },
  { key: 'TELNYX_CONNECTION_ID', required: true, defaultValue: '', note: 'Call Control / AI connection id' },
  { key: 'TELNYX_FROM_NUMBER', required: true, defaultValue: '', note: 'E.164 outbound/inbound DID' },
  { key: 'TELNYX_PUBLIC_KEY', required: true, defaultValue: '', note: 'Ed25519 public key for webhook signatures' },
  { key: 'TELNYX_ASSISTANT_ID', required: true, defaultValue: '', note: 'From scripts/register-assistant.ts' },
  { key: 'SALES_TRANSFER_NUMBER', required: false, defaultValue: '', note: 'Human warm-transfer destination' },
  { key: 'DIALER_ENABLED', required: false, defaultValue: 'false', note: 'Master outbound dial switch' },
  { key: 'DIALER_MAX_CONCURRENT', required: false, defaultValue: '5', note: 'Max simultaneous outbound AI calls' },
  { key: 'DIALER_DAILY_CAP', required: false, defaultValue: '20', note: 'Max outbound dials per shop per day' },
  { key: 'DIALER_DRY_RUN', required: false, defaultValue: 'false', note: 'Log would-dial without Telnyx' },
  { key: 'US_STATE_BLOCKLIST', required: false, defaultValue: '', note: 'Comma-separated US state codes to skip' },
  { key: 'CRON_SECRET', required: true, defaultValue: '', note: 'Bearer secret for /api/dialer/tick' },
  { key: 'LEADS_IMPORT_SHOP_ID', required: true, defaultValue: '', note: 'Default shop id for cron/inbound mapping' },
  { key: 'SLACK_WEBHOOK_URL', required: false, defaultValue: '', note: 'Optional Slack alerts for handoffs' },
  { key: 'AI_PROMPT_VERSION', required: false, defaultValue: 'v1', note: 'Active prompts/agent.<version>.md' }
]

// silence unused
void truthy
