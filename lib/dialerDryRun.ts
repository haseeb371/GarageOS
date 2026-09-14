/**
 * Pure helpers for dry-run dial decisions (unit-tested without DB).
 */
export function buildDryRunContactLog(input: {
  shopId: string
  leadId: string
  to: string
  campaign?: string
  now?: number
}) {
  const now = input.now ?? Date.now()
  return {
    shopId: input.shopId,
    leadId: input.leadId,
    actorId: 'dialer',
    outcome: 'dry_run' as const,
    detail: `DRY RUN would dial ${input.to} · campaign=${input.campaign || ''}`,
    direction: 'outbound' as const,
    status: 'dry_run' as const,
    aiDisclosure: true,
    createdAt: now,
    endedAt: now
  }
}

export function shouldSkipTelnyxCall(dryRun: boolean) {
  return dryRun === true
}
