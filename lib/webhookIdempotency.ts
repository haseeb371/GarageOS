const seen = new Map<string, number>()
const MAX = 1000

export function rememberWebhookEvent(eventId: string, now = Date.now()): boolean {
  /** @returns true if this is a NEW event (should process), false if duplicate */
  if (!eventId) return true
  if (seen.has(eventId)) return false
  seen.set(eventId, now)
  if (seen.size > MAX) {
    const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, seen.size - MAX)
    for (const [id] of oldest) seen.delete(id)
  }
  return true
}

export function resetWebhookIdempotencyForTests() {
  seen.clear()
}
