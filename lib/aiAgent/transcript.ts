import { OUTBOUND_GREETING } from './prompt'
import type { TranscriptChunk } from '@/lib/schema'

const DISCLOSURE_PATTERNS = [
  /ai assistant/i,
  /i'?m an ai/i,
  /this is an ai/i,
  /artificial intelligence/i,
  /automated assistant/i
]

export function hasAiDisclosure(text: string): boolean {
  // Spec: first assistant message must contain "AI" or "automated".
  return /\bAI\b/i.test(text) || /automated/i.test(text) || DISCLOSURE_PATTERNS.some(re => re.test(text))
}

export function firstAssistantMessage(chunks: TranscriptChunk[]): string {
  const first = chunks.find(c => /assistant|ai|bot/i.test(c.role) || c.role === 'assistant')
  return first?.text || ''
}

/** Returns true when the first assistant utterance includes required AI disclosure. */
export function assertOutboundDisclosure(chunks: TranscriptChunk[]): {
  ok: boolean
  firstMessage: string
} {
  const firstMessage = firstAssistantMessage(chunks)
  if (!firstMessage) return { ok: false, firstMessage: '' }
  return { ok: hasAiDisclosure(firstMessage), firstMessage }
}

export function expectedOutboundGreeting() {
  return OUTBOUND_GREETING
}

export function detectDncIntent(text: string): boolean {
  return /\b(stop|don'?t call|do not call|remove me|take me off|never call)\b/i.test(text)
}
