/**
 * One-shot: register AutoGaragify sales AI assistant with Telnyx and print the id.
 *
 * Usage:
 *   npx tsx scripts/register-assistant.ts
 *
 * Requires TELNYX_API_KEY (and APP_URL for tool webhook URLs).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createAIAssistant } from '../lib/telnyx'

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

const MODEL_CANDIDATES = [
  process.env.TELNYX_AI_MODEL?.trim(),
  'Qwen/Qwen3-235B-A22B',
  'moonshotai/Kimi-K2.5',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4o-mini'
].filter(Boolean) as string[]

async function main() {
  loadEnvFile('.env')
  loadEnvFile('.env.local')
  if (!process.env.APP_URL) process.env.APP_URL = 'https://autogaragify.com'

  let lastError = ''
  for (const model of MODEL_CANDIDATES) {
    console.log(`Trying model: ${model}`)
    const result = await createAIAssistant({ model })
    if (result.ok) {
      upsertEnvLocal('TELNYX_ASSISTANT_ID', result.assistantId)
      console.log('\nSaved to .env.local:\n')
      console.log(`TELNYX_ASSISTANT_ID=${result.assistantId}\n`)
      console.log(`Model used: ${model}`)
      return
    }
    lastError = result.error
    console.log(`  failed: ${result.error}`)
  }

  console.error('Failed to create assistant:', lastError)
  process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
