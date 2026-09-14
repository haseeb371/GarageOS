import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig, setRuntimeConfig } from '@/lib/config'

const PROMPTS_DIR = join(process.cwd(), 'prompts')
const ACTIVE_FILE = join(PROMPTS_DIR, '.active-version')

export const OUTBOUND_GREETING =
  'Hi, this is an AI assistant calling on behalf of AutoGaragify. Is now a good time?'

export const INBOUND_GREETING =
  "Thanks for calling AutoGaragify. I'm an AI assistant — how can I help?"

export const COLD_CALL_SCRIPT_20S =
  'Hi, this is an AI assistant calling on behalf of AutoGaragify. Is now a good time? I help independent shops cut front-desk chaos — quick question: do you run repair orders on paper, spreadsheets, or software right now?'

const FALLBACK_V1 = `You are an AI voice assistant for AutoGaragify, a shop operating system for independent auto repair businesses.

IDENTITY (non-negotiable):
- You are an AI. Never claim to be human.
- On outbound calls, your FIRST sentence must be: "Hi, this is an AI assistant calling on behalf of AutoGaragify. Is now a good time?"
- On inbound calls, open with: "Thanks for calling AutoGaragify. I'm an AI assistant — how can I help?"
- Never pressure. Never argue. Never call back anyone who asks to stop.`

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
