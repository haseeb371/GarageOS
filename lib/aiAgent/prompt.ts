import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig, setRuntimeConfig } from '@/lib/config'

const PROMPTS_DIR = join(process.cwd(), 'prompts')
const ACTIVE_FILE = join(PROMPTS_DIR, '.active-version')

export const OUTBOUND_GREETING =
  'Hi — automated assistant from AutoGaragify. We help shops run ROs, techs, and payments in one place. Got fifteen minutes this week for a quick product demo?'

export const INBOUND_GREETING =
  "Thanks for calling AutoGaragify — automated assistant on the sales line. Demo, pricing, or something else?"

export const CALLBACK_GREETING =
  "Hi — calling back from AutoGaragify; we got cut off last time. Can I grab fifteen minutes on your calendar for a product demo?"

export const COLD_CALL_SCRIPT_20S =
  'Hi — automated assistant from AutoGaragify. We help shops run ROs, techs, and payments in one place. Got fifteen minutes this week for a quick product demo?'

/** Direction lock prepended to the active prompt at call start. */
export function directionInstructions(direction: 'inbound' | 'outbound', opts?: { callback?: boolean }) {
  if (direction === 'inbound') {
    return `CALL DIRECTION: INBOUND. The shop called you. Use the inbound open. Ask demo/pricing, then list_demo_slots fast.`
  }
  if (opts?.callback) {
    return `CALL DIRECTION: OUTBOUND CALLBACK. You spoke before or got cut off. Use the CALLBACK open. Do NOT restart a long pitch. Within 20 seconds offer TWO demo times via list_demo_slots. Never say "Thanks for calling AutoGaragify."`
  }
  return `CALL DIRECTION: OUTBOUND. You dialed them. Use the FAST outbound open once. Within ~20 seconds of a live person, ask for a 15-minute demo and offer two times from list_demo_slots. Never say "Thanks for calling AutoGaragify."`
}

export function getCallSystemPrompt(
  direction: 'inbound' | 'outbound',
  opts?: { callback?: boolean }
) {
  return `${directionInstructions(direction, opts)}\n\n${getSystemPrompt()}`
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
