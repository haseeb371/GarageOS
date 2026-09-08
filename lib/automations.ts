import type { Kind } from './domain'
import { buildDeclinedWorkCampaign, declinedWorkSegment } from './marketing'
import { invoiceForOrder } from './invoicing'
import { lowStockItems } from './inventoryAlerts'
import { smsConfigured } from './sms'
import { emailConfigured } from './email'
import { buildReviewRequestMessage, preferredReviewUrl } from './reviews'

type Row = Record<string, unknown> & { id: string }

export const AUTOMATION_TRIGGERS = [
  'Appointment created',
  'Repair order authorized',
  'Repair order completed',
  'Repair order has declined work',
  'Invoice created',
  'Invoice paid',
  'Payment captured',
  'Inventory low stock'
] as const

export const AUTOMATION_ACTIONS = [
  'Create confirmation task',
  'Create internal task',
  'Create service reminder',
  'Create invoice',
  'Create follow-up appointment',
  'Create declined work campaign',
  'Queue review request',
  'Create low-stock alert task'
] as const

export const AUTOMATION_CONDITIONS = [
  'Always',
  'Source is online booking',
  'Status is Estimate',
  'Status is Authorized',
  'Status is Completed',
  'Status is Paid',
  'Status is Due'
] as const

export const AUTOMATION_DELAY_OPTIONS = [0, 5, 15, 30, 60, 120, 240, 1440] as const

export type AutomationContext = {
  previous?: Row | null
  invoices?: Row[]
  orders?: Row[]
  customers?: Row[]
  vehicles?: Row[]
  inventory?: Row[]
  shops?: Row[]
  appointments?: Row[]
  payments?: Row[]
  automationJobs?: Row[]
  now?: number
}

function matchesConditions(conditions: string, record: Row) {
  const text = String(conditions || '').trim()
  if (!text || text === 'Always') return true
  if (text === 'Source is online booking') return String(record.source) === 'Online booking'
  if (text.startsWith('Status is ')) return String(record.status) === text.slice('Status is '.length)
  return true
}

function statusBecame(record: Row, previous: Row | null | undefined, status: string) {
  return String(record.status) === status && String(previous?.status || '') !== status
}

function orderGainedDeclinedWork(record: Row, previous: Row | null | undefined) {
  const jobs = Array.isArray(record.jobs) ? (record.jobs as Row[]) : []
  const declinedNow = jobs.filter(job => job.decision === 'Declined')
  if (!declinedNow.length) return false
  const prevJobs = Array.isArray(previous?.jobs) ? (previous!.jobs as Row[]) : []
  const previouslyDeclined = new Set(prevJobs.filter(job => job.decision === 'Declined').map(job => String(job.id)))
  return declinedNow.some(job => !previouslyDeclined.has(String(job.id)))
}

function declinedFingerprint(record: Row) {
  const jobs = Array.isArray(record.jobs) ? (record.jobs as Row[]) : []
  return jobs
    .filter(job => job.decision === 'Declined')
    .map(job => String(job.id))
    .sort()
    .join(',')
}

export function automationFingerprint(workflowId: string, trigger: string, kind: string, record: Row) {
  const extra = trigger === 'Repair order has declined work' ? `:${declinedFingerprint(record)}` : ''
  return `${workflowId}|${trigger}|${kind}|${record.id}${extra}`
}

function shouldRunTrigger(trigger: string, kind: Kind, record: Row, previous?: Row | null) {
  if (trigger === 'Appointment created') return kind === 'appointments' && !previous
  if (trigger === 'Repair order authorized') {
    return kind === 'orders' && statusBecame(record, previous, 'Authorized')
  }
  if (trigger === 'Repair order completed') {
    return kind === 'orders' && statusBecame(record, previous, 'Completed')
  }
  if (trigger === 'Repair order has declined work') {
    return kind === 'orders' && orderGainedDeclinedWork(record, previous)
  }
  if (trigger === 'Invoice created') return kind === 'invoices' && !previous
  if (trigger === 'Invoice paid') return kind === 'invoices' && statusBecame(record, previous, 'Paid')
  if (trigger === 'Payment captured') {
    return (
      kind === 'payments' &&
      String(record.status || 'Captured') === 'Captured' &&
      (!previous || String(previous.status || '') !== 'Captured')
    )
  }
  if (trigger === 'Inventory low stock') {
    return (
      kind === 'inventory' &&
      Number(record.onHand) <= Number(record.reorderAt) &&
      !(previous && Number(previous.onHand) <= Number(previous.reorderAt))
    )
  }
  return false
}

function reminderChannel() {
  if (smsConfigured()) return 'SMS live'
  if (emailConfigured()) return 'Email live'
  return 'SMS sandbox'
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function alreadyQueuedOrRan(jobs: Row[] | undefined, fingerprint: string) {
  return (jobs || []).some(job => {
    if (String(job.fingerprint) !== fingerprint) return false
    const status = String(job.status || '')
    return status === 'Scheduled' || status === 'Awaiting approval' || status === 'Completed'
  })
}

function materializeAction(workflow: Row, kind: Kind, record: Row, context: AutomationContext, stamp: string) {
  const effects: Array<{ kind: string; record: Row }> = []
  const action = String(workflow.action || '')
  const trigger = String(workflow.trigger || '')

  if (action === 'Create confirmation task' || action === 'Create internal task') {
    effects.push({
      kind: 'supportTickets',
      record: {
        id: uid('SUP'),
        subject:
          trigger === 'Appointment created'
            ? `Confirm appointment ${record.id}`
            : trigger === 'Inventory low stock'
              ? `Low stock: ${record.name || record.sku || record.id}`
              : `Automation: ${workflow.name}`,
        priority: trigger === 'Inventory low stock' ? 'High' : 'Normal',
        status: 'Open',
        category: 'Operations',
        requester: String(record.source || 'Automation'),
        description: `${workflow.name} ran for ${kind} ${record.id}. Review and follow up if needed.`,
        createdAt: stamp,
        resolvedAt: '',
        automationId: workflow.id,
        sourceRecordId: record.id
      }
    })
  }

  if (action === 'Create service reminder') {
    effects.push({
      kind: 'serviceReminders',
      record: {
        id: uid('SR'),
        customerId: String(record.customerId || ''),
        vehicleId: String(record.vehicleId || ''),
        service: String(record.service || record.name || 'Follow-up service'),
        dueDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
        dueMileage: 0,
        status: 'Due soon',
        channel: reminderChannel(),
        lastSentAt: null,
        notes: `Created automatically by ${workflow.name}.`,
        automationId: workflow.id,
        sourceRecordId: record.id
      }
    })
  }

  if (action === 'Create invoice' && kind === 'orders' && String(record.status) === 'Completed') {
    const draft = invoiceForOrder(record, context.invoices || [])
    if (draft) {
      effects.push({
        kind: 'invoices',
        record: { ...draft, automationId: workflow.id, sourceRecordId: record.id }
      })
    }
  }

  if (action === 'Create follow-up appointment' && (kind === 'orders' || kind === 'invoices' || kind === 'payments')) {
    const customerId = String(record.customerId || '')
    const vehicleId = String(record.vehicleId || '')
    if (customerId) {
      const date = new Date(Date.now() + 3 * 86400000)
      effects.push({
        kind: 'appointments',
        record: {
          id: uid('A'),
          customerId,
          vehicleId,
          date: date.toISOString().slice(0, 10),
          time: '09:00',
          service: String(record.service || 'Follow-up visit'),
          status: 'Pending',
          source: 'Automation',
          notes: `Created by automation ${workflow.name}`,
          linkedOrderId: kind === 'orders' ? record.id : '',
          automationId: workflow.id,
          sourceRecordId: record.id
        }
      })
    }
  }

  if (action === 'Create declined work campaign') {
    const orders = kind === 'orders' ? [record, ...(context.orders || []).filter(o => o.id !== record.id)] : context.orders || []
    const segment = declinedWorkSegment(orders, context.customers || [], context.vehicles || [])
    if (segment.length) {
      const campaign = buildDeclinedWorkCampaign(segment)
      campaign.channel = reminderChannel()
      effects.push({
        kind: 'campaigns',
        record: {
          ...campaign,
          notes: `Created by automation ${workflow.name}`,
          automationId: workflow.id,
          sourceRecordId: record.id
        } as Row
      })
    }
  }

  if (action === 'Queue review request') {
    const customerId = String(record.customerId || '')
    const customer = (context.customers || []).find(c => c.id === customerId)
    const shop = (context.shops || [])[0]
    const reviewUrl = preferredReviewUrl(shop)
    if (customerId) {
      const message = reviewUrl
        ? buildReviewRequestMessage({
            customerName: String(customer?.name || 'there'),
            shopName: String(shop?.name || 'our shop'),
            reviewUrl,
            platform: 'Google'
          })
        : `Thanks for visiting ${shop?.name || 'us'}! Please leave a review when you can.`
      const live = smsConfigured() || emailConfigured()
      effects.push({
        kind: 'reviews',
        record: {
          id: uid('RV'),
          customerId,
          customer: customer?.name || customerId,
          rating: 0,
          text: '',
          source: 'Automation',
          status: live ? 'Ready to send' : 'Request queued',
          response: '',
          reviewedAt: new Date().toISOString().slice(0, 10),
          requestMessage: message,
          requestUrl: reviewUrl || '',
          notes: live
            ? `Queued by ${workflow.name}. Open Marketing → Reviews and send via SMS/email.`
            : `Queued by ${workflow.name}. Connect SMS/email, then send from Marketing → Reviews.`,
          automationId: workflow.id,
          sourceRecordId: record.id
        }
      })
    }
  }

  if (action === 'Create low-stock alert task') {
    const items =
      kind === 'inventory' && Number(record.onHand) <= Number(record.reorderAt)
        ? [record]
        : lowStockItems(context.inventory || [])
    if (items.length) {
      effects.push({
        kind: 'supportTickets',
        record: {
          id: uid('SUP'),
          subject: `Low stock · ${items.length} part${items.length === 1 ? '' : 's'}`,
          priority: 'High',
          status: 'Open',
          category: 'Inventory',
          requester: 'Automation',
          description: items
            .slice(0, 20)
            .map(item => `${item.name || item.sku}: ${item.onHand} on hand (reorder at ${item.reorderAt})`)
            .join('\n'),
          createdAt: stamp,
          resolvedAt: '',
          automationId: workflow.id,
          sourceRecordId: record.id
        }
      })
    }
  }

  return effects
}

function buildJob(input: {
  workflow: Row
  kind: Kind
  record: Row
  fingerprint: string
  status: 'Scheduled' | 'Awaiting approval' | 'Completed'
  runAt: string
  stamp: string
  resultIds?: string[]
}) {
  return {
    kind: 'automationJobs',
    record: {
      id: uid('AJ'),
      workflowId: input.workflow.id,
      workflowName: input.workflow.name,
      trigger: input.workflow.trigger,
      action: input.workflow.action,
      sourceKind: input.kind,
      sourceRecordId: input.record.id,
      fingerprint: input.fingerprint,
      status: input.status,
      runAt: input.runAt,
      createdAt: input.stamp,
      completedAt: input.status === 'Completed' ? input.stamp : '',
      resultIds: input.resultIds || [],
      notes:
        input.status === 'Awaiting approval'
          ? 'Approve this job to run the automation action.'
          : input.status === 'Scheduled'
            ? `Scheduled to run at ${input.runAt}.`
            : 'Completed successfully.'
    } as Row
  }
}

/**
 * Plan automation side effects for a record change.
 * Honors delayMinutes (Scheduled jobs), requiresApproval, and duplicate fingerprints.
 */
export function automationEffects(
  kind: Kind,
  record: Row,
  automations: Row[],
  context: AutomationContext = {}
) {
  const effects: Array<{ kind: string; record: Row }> = []
  const nowMs = context.now || Date.now()
  const stamp = new Date(nowMs).toISOString()
  const previous = context.previous
  const active = automations.filter(w => w.status === 'Active')

  for (const workflow of active) {
    const trigger = String(workflow.trigger || '')
    if (!shouldRunTrigger(trigger, kind, record, previous)) continue
    if (!matchesConditions(String(workflow.conditions || ''), record)) continue

    const fingerprint = automationFingerprint(String(workflow.id), trigger, kind, record)
    if (alreadyQueuedOrRan(context.automationJobs, fingerprint)) continue

    const delayMinutes = Math.max(0, Number(workflow.delayMinutes || 0))
    const needsApproval = Boolean(workflow.requiresApproval)

    if (needsApproval || delayMinutes > 0) {
      const runAt = new Date(nowMs + delayMinutes * 60_000).toISOString()
      effects.push(
        buildJob({
          workflow,
          kind,
          record,
          fingerprint,
          status: needsApproval ? 'Awaiting approval' : 'Scheduled',
          runAt,
          stamp
        })
      )
      continue
    }

    const created = materializeAction(workflow, kind, record, context, stamp)
    if (!created.length) continue

    effects.push(...created)
    effects.push(
      buildJob({
        workflow,
        kind,
        record,
        fingerprint,
        status: 'Completed',
        runAt: stamp,
        stamp,
        resultIds: created.map(item => String(item.record.id))
      })
    )
    effects.push({
      kind: 'workflowAutomations',
      record: { ...workflow, lastRunAt: stamp, runCount: Number(workflow.runCount || 0) + 1 }
    })
  }

  return effects
}

/** Release due Scheduled jobs (and optionally a specific approved job) into concrete records. */
export function releaseAutomationJobs(
  jobs: Row[],
  workflows: Row[],
  context: AutomationContext,
  options: { jobId?: string; forceApprove?: boolean; now?: number } = {}
) {
  const effects: Array<{ kind: string; record: Row }> = []
  const nowMs = options.now || Date.now()
  const stamp = new Date(nowMs).toISOString()

  for (const job of jobs) {
    if (options.jobId && job.id !== options.jobId) continue
    const status = String(job.status || '')
    const due = !job.runAt || new Date(String(job.runAt)).getTime() <= nowMs

    const approved = options.forceApprove && options.jobId === job.id
    if (status === 'Awaiting approval' && !approved) continue
    if (status === 'Scheduled' && !due && !approved) continue
    if (status === 'Completed' || status === 'Cancelled') continue
    if (!['Scheduled', 'Awaiting approval'].includes(status)) continue

    const workflow = workflows.find(w => w.id === job.workflowId)
    if (!workflow || String(workflow.status) !== 'Active') {
      effects.push({
        kind: 'automationJobs',
        record: {
          ...job,
          status: 'Cancelled',
          completedAt: stamp,
          notes: 'Cancelled because the workflow is missing or not Active.'
        }
      })
      continue
    }

    const sourceKind = String(job.sourceKind || 'orders') as Kind
    const sourcePool =
      sourceKind === 'orders'
        ? context.orders
        : sourceKind === 'invoices'
          ? context.invoices
          : sourceKind === 'inventory'
            ? context.inventory
            : sourceKind === 'appointments'
              ? context.appointments
              : sourceKind === 'payments'
                ? context.payments
                : sourceKind === 'customers'
                  ? context.customers
                  : sourceKind === 'vehicles'
                    ? context.vehicles
                    : undefined
    const source =
      (sourcePool || []).find(row => row.id === job.sourceRecordId) ||
      ({
        id: String(job.sourceRecordId || 'unknown'),
        customerId: '',
        vehicleId: '',
        service: String(workflow.action || 'Follow-up')
      } as Row)

    const created = materializeAction(workflow, sourceKind, source, context, stamp)
    if (created.length) effects.push(...created)

    effects.push({
      kind: 'automationJobs',
      record: {
        ...job,
        status: 'Completed',
        completedAt: stamp,
        resultIds: created.map(item => String(item.record.id)),
        notes: created.length ? `Completed with ${created.length} record(s).` : 'Completed with no records (action conditions not met).'
      }
    })
    effects.push({
      kind: 'workflowAutomations',
      record: { ...workflow, lastRunAt: stamp, runCount: Number(workflow.runCount || 0) + 1 }
    })
  }

  return effects
}

/** Simulate what would run for a workflow against sample shop data (Test run UI). */
export function previewAutomation(workflow: Row, state: Record<string, Row[]>) {
  const kindGuess =
    String(workflow.trigger).includes('Appointment')
      ? 'appointments'
      : String(workflow.trigger).includes('Inventory')
        ? 'inventory'
        : String(workflow.trigger).includes('Payment')
          ? 'payments'
          : String(workflow.trigger).includes('Invoice')
            ? 'invoices'
            : 'orders'

  const samples = state[kindGuess] || []
  const sample = samples[0]
  if (!sample) {
    return { ok: false as const, message: `No ${kindGuess} records to simulate against.`, effects: [] as Array<{ kind: string; record: Row }> }
  }

  const forced = [{ ...workflow, status: 'Active', requiresApproval: false, delayMinutes: 0 }]
  const previous =
    kindGuess === 'orders'
      ? { ...sample, status: 'In progress', jobs: (sample.jobs as Row[] | undefined)?.map(j => ({ ...j, decision: 'Pending' })) }
      : kindGuess === 'inventory'
        ? { ...sample, onHand: Number(sample.reorderAt) + 5 }
        : kindGuess === 'invoices'
          ? { ...sample, status: 'Due' }
          : null

  const record =
    kindGuess === 'orders' && String(workflow.trigger).includes('declined')
      ? {
          ...sample,
          jobs: [
            ...((sample.jobs as Row[]) || []),
            {
              id: `J-sim-${Date.now()}`,
              name: 'Simulated declined service',
              decision: 'Declined',
              laborHours: 1,
              laborRate: 140,
              partsPrice: 0
            }
          ]
        }
      : kindGuess === 'orders' && String(workflow.trigger).includes('completed')
        ? { ...sample, status: 'Completed' }
        : kindGuess === 'orders' && String(workflow.trigger).includes('authorized')
          ? { ...sample, status: 'Authorized' }
          : kindGuess === 'inventory'
            ? { ...sample, onHand: Number(sample.reorderAt) }
            : kindGuess === 'invoices' && String(workflow.trigger).includes('paid')
              ? { ...sample, status: 'Paid' }
              : sample

  const effects = automationEffects(kindGuess as Kind, record as Row, forced, {
    previous: previous as Row | null,
    invoices: state.invoices || [],
    orders: state.orders || [],
    customers: state.customers || [],
    vehicles: state.vehicles || [],
    inventory: state.inventory || [],
    shops: state.shops || [],
    automationJobs: []
  }).filter(effect => effect.kind !== 'workflowAutomations' && effect.kind !== 'automationJobs')

  const delayNote =
    Number(workflow.delayMinutes || 0) > 0
      ? ` Live runs wait ${workflow.delayMinutes} minute(s) before creating records.`
      : ''
  const approvalNote = workflow.requiresApproval ? ' Live runs wait for approval.' : ''

  return {
    ok: true as const,
    message: `Would create ${effects.length} record(s) from trigger “${workflow.trigger}” on sample ${kindGuess} ${record.id}.${delayNote}${approvalNote}`,
    effects
  }
}
