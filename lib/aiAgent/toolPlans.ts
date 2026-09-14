/** Pure AI tool side-effect plans (no DB / no server-only). */

export function markDncPlan(input: {
  shopId: string
  leadId: string
  phoneDigits?: string | null
}) {
  return {
    leadUpdate: { id: input.leadId, status: 'do_not_call' as const },
    dncInsert: input.phoneDigits
      ? { shopId: input.shopId, phoneDigits: input.phoneDigits, reason: 'Caller requested DNC' }
      : null
  }
}
