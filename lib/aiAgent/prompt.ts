import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig, setRuntimeConfig } from '@/lib/config'

const PROMPTS_DIR = join(process.cwd(), 'prompts')
const ACTIVE_FILE = join(PROMPTS_DIR, '.active-version')

export const OUTBOUND_GREETING =
  'Hi — this is an automated assistant calling from AutoGaragify. Did I catch you for thirty seconds?'

export const INBOUND_GREETING =
  "Thanks for calling AutoGaragify — I'm an automated assistant on the sales line. Are you looking for a product demo, pricing, or something else?"

export const COLD_CALL_SCRIPT_20S =
  'Hi — this is an automated assistant calling from AutoGaragify. Did I catch you for thirty seconds? We help independent shops run repair orders, inspections, techs, and payments in one workspace. Quick question: do you run repair orders on paper, spreadsheets, or software right now?'

/** Direction lock prepended to the active prompt at call start. */
export function directionInstructions(direction: 'inbound' | 'outbound') {
  if (direction === 'inbound') {
    return `CALL DIRECTION: INBOUND. The shop called you. Use the inbound open. Never pretend you dialed them. Never say "is the owner available for a quick minute" as a cold-call opener.`
  }
  return `CALL DIRECTION: OUTBOUND. You dialed them. Use the outbound open only once. Never say "Thanks for calling AutoGaragify." Stay on the sales pitch and book a calendar demo.`
}

export function getCallSystemPrompt(direction: 'inbound' | 'outbound') {
  return `${directionInstructions(direction)}\n\n${getSystemPrompt()}`
}

const FALLBACK_V1 = `You are an AutoGaragify sales voice agent for independent auto repair shops.

IDENTITY:
- Represent AutoGaragify products in a natural sales tone.
- Briefly disclose you are an automated/AI assistant in the first sentence. Never claim to be human.
- Outbound open: "Hi, this is an automated assistant calling from AutoGaragify — is the owner or manager available for a quick minute?"
- Never pressure. Honor stop/DNC immediately.`

function normalizeVersion(raw: string) {
  const v = String(raw || 'v1').trim().toLowerCase()
  return v.startsWith('v') ? v : `v${v}`
}

function promptPath(version: string) {
  return join(PROMPTS_DIR, `agent.${normalizeVersion(version)}.md`)
}

export function listPromptVersions(): string[] {
  if (!existsSync(PROMPTS_DIR)) return ['v1']
  return readdirSync(PROMPTS_DIR)
    .filter(f => /^agent\.v[\w.-]+\.md$/i.test(f))
    .map(f => f.replace(/^agent\./i, '').replace(/\.md$/i, ''))
    .sort()
}

export function getActivePromptVersion(): string {
  if (existsSync(ACTIVE_FILE)) {
    try {
      const fromFile = readFileSync(ACTIVE_FILE, 'utf8').trim()
      if (fromFile) return normalizeVersion(fromFile)
    } catch {
      /* fall through */
    }
  }
  return normalizeVersion(getConfig().AI_PROMPT_VERSION)
}

export function loadSystemPrompt(version?: string): { version: string; text: string; fallback: boolean } {
  const requested = normalizeVersion(version || getActivePromptVersion())
  const primary = promptPath(requested)
  if (existsSync(primary)) {
    return { version: requested, text: readFileSync(primary, 'utf8'), fallback: false }
  }
  const v1 = promptPath('v1')
  if (existsSync(v1)) {
    return { version: 'v1', text: readFileSync(v1, 'utf8'), fallback: requested !== 'v1' }
  }
  return { version: 'v1', text: FALLBACK_V1, fallback: true }
}

/** Active system prompt text (re-reads file / runtime version each call). */
export function getSystemPrompt(): string {
  return loadSystemPrompt().text
}

/** @deprecated Prefer getSystemPrompt() — kept for import compatibility. */
export const SYSTEM_PROMPT = FALLBACK_V1

export function activatePromptVersion(version: string, content?: string) {
  const ver = normalizeVersion(version)
  if (!existsSync(PROMPTS_DIR)) mkdirSync(PROMPTS_DIR, { recursive: true })
  const path = promptPath(ver)
  if (content !== undefined) {
    writeFileSync(path, content, 'utf8')
  } else if (!existsSync(path)) {
    throw new Error(`Prompt file missing: agent.${ver}.md`)
  }
  writeFileSync(ACTIVE_FILE, ver, 'utf8')
  setRuntimeConfig({ AI_PROMPT_VERSION: ver })
  return { version: ver, path }
}

export function readPromptFile(version: string) {
  const ver = normalizeVersion(version)
  const path = promptPath(ver)
  if (!existsSync(path)) return null
  return { version: ver, path, text: readFileSync(path, 'utf8') }
}
