import type { Kind } from '@/lib/domain'
import { automationEffects, releaseAutomationJobs, type AutomationContext } from '@/lib/automations'

type Row = Record<string, unknown> & { id: string }

export function buildAutomationContext(
  refreshed: Array<{ kind: string; data: Row }>,
  previous?: Row | null
): AutomationContext {
  const byKind = (kind: string) => refreshed.filter(row => row.kind === kind).map(row => row.data)
  return {
    previous,
    invoices: byKind('invoices'),
    orders: byKind('orders'),
    customers: byKind('customers'),
    vehicles: byKind('vehicles'),
    inventory: byKind('inventory'),
    shops: byKind('shops'),
    appointments: byKind('appointments'),
    payments: byKind('payments'),
    automationJobs: byKind('automationJobs')
  }
}

/** Plan trigger effects then release any due scheduled jobs in one pass. */
export function planAutomationsForSave(
  kind: Kind,
  record: Row,
  automations: Row[],
  context: AutomationContext
) {
  const primary = automationEffects(kind, record, automations, context)
  const jobsAfterPrimary = [
    ...(context.automationJobs || []),
    ...primary.filter(e => e.kind === 'automationJobs').map(e => e.record)
  ]
  const due = releaseAutomationJobs(jobsAfterPrimary, automations, {
    ...context,
    automationJobs: jobsAfterPrimary
  })
  return [...primary, ...due]
}
