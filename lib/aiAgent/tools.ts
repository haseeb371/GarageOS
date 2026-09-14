import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  complianceViolations,
  contactLogs,
  dncPhones,
  notifications,
  salesLeads
} from '@/lib/schema'
import { normalizeUsPhone } from '@/lib/leads'
import { transferCall } from '@/lib/telnyx'
import { markDncPlan } from '@/lib/aiAgent/toolPlans'
import {
  assistantToolDefinitions,
  type AgentToolName
} from '@/lib/aiAgent/toolDefinitions'
import { bookDemoAppointment, listDemoSlots } from '@/lib/salesCalendar'
import { getConfig } from '@/lib/config'

export type { AgentToolName }
export { markDncPlan, assistantToolDefinitions }

async function notifyShop(shopId: string, type: string, payload: Record<string, unknown>) {
  const now = Date.now()
  await db.insert(notifications).values({
    id: `NTF-${now}-${Math.random().toString(36).slice(2, 8)}`,
    shopId,
    type,
    payload,
    createdAt: now,
    readAt: null
  })

  const slack = process.env.SLACK_WEBHOOK_URL?.trim()
  if (slack) {
    await fetch(slack, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[AutoGaragify] ${type}: ${JSON.stringify(payload).slice(0, 500)}`
      })
    }).catch(() => undefined)
  } else {
    console.log(`[notify] ${type}`, payload)
  }
}

function resolveShopId(shopId: string) {
  return shopId && shopId !== 'unknown' ? shopId : getConfig().LEADS_IMPORT_SHOP_ID || shopId
}

export async function dispatchAgentTool(input: {
  name: string
  args: Record<string, unknown>
  shopId: string
  callControlId?: string
  direction?: 'inbound' | 'outbound'
}) {
  const shopId = resolveShopId(input.shopId)
  const leadId = String(input.args.lead_id || '')
  const now = Date.now()
  const direction = input.direction || 'outbound'

  const log = async (outcome: string, detail: string) => {
    await db.insert(contactLogs).values({
      shopId,
      leadId: leadId || null,
      actorId: 'ai-assistant',
      outcome,
      detail,
      direction,
      telnyxCallId: input.callControlId || null,
      status: outcome,
      transcript: [],
      recordingUrl: null,
      durationSeconds: null,
      aiDisclosure: true,
      endedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  if (input.name === 'list_demo_slots') {
    const slots = await listDemoSlots({ shopId, limit: 6 })
    if (!slots.length) {
      return { ok: false, message: 'No open demo slots in the next two weeks.' }
    }
    const spoken = slots.map((s, i) => `${i + 1}) ${s.label}`).join('; ')
    return {
      ok: true,
      message: `Offer two of these times: ${spoken}`,
      slots: slots.map(s => ({ starts_at: s.startsAt, label: s.label, iso: new Date(s.startsAt).toISOString() }))
    }
  }

  if (input.name === 'book_demo') {
    const raw = String(input.args.datetime_iso || input.args.preferred_time || '')
    let startsAt = Number(raw)
    if (!Number.isFinite(startsAt) || startsAt < 1e11) {
      const parsed = Date.parse(raw)
      startsAt = Number.isFinite(parsed) ? parsed : NaN
    }
    const booked = await bookDemoAppointment({
      shopId,
      leadId: leadId || null,
      businessName: String(input.args.business_name || ''),
      contactName: String(input.args.contact_name || ''),
      phone: String(input.args.phone || ''),
      email: String(input.args.email || ''),
      startsAt,
      source: direction === 'inbound' ? 'inbound_call' : 'outbound_call',
      notes: 'Booked by voice agent'
    })
    if (!booked.ok) {
      await log('failed', booked.error)
      return { ok: false, message: booked.error }
    }
    await log('interested', booked.message)
    await notifyShop(shopId, 'demo_booked', {
      leadId: booked.leadId,
      demoId: booked.id,
      when: booked.label
    })
    return { ok: true, message: booked.message, demo_id: booked.id, when: booked.label }
  }

  if (input.name === 'mark_interested') {
    const preferred = String(input.args.preferred_time || input.args.datetime_iso || '')
    if (leadId) {
      await db
        .update(salesLeads)
        .set({
          status: 'interested',
          notes: preferred ? `Demo preference: ${preferred}` : undefined,
          updatedAt: now
        })
        .where(and(eq(salesLeads.id, leadId), eq(salesLeads.shopId, shopId)))
    }
    await log('interested', preferred || 'Lead marked interested')
    await notifyShop(shopId, 'lead_interested', { leadId, preferred })
    return {
      ok: true,
      message: preferred
        ? `Noted interest for ${preferred}. Next use list_demo_slots and book_demo to lock a calendar time.`
        : 'Marked interested. Offer two calendar times with list_demo_slots.'
    }
  }

  if (input.name === 'mark_not_interested') {
    const reason = String(input.args.reason || 'not interested')
    if (leadId) {
      await db
        .update(salesLeads)
        .set({ status: 'not_interested', notes: reason, updatedAt: now })
        .where(and(eq(salesLeads.id, leadId), eq(salesLeads.shopId, shopId)))
    }
    await log('not_interested', reason)
    return { ok: true, message: 'Marked not interested' }
  }

  if (input.name === 'mark_dnc') {
    let digits = ''
    if (leadId) {
      const [lead] = await db
        .select()
        .from(salesLeads)
        .where(and(eq(salesLeads.id, leadId), eq(salesLeads.shopId, shopId)))
        .limit(1)
      digits = lead?.phoneDigits || ''
      const plan = markDncPlan({
        shopId,
        leadId,
        phoneDigits: digits
      })
      await db
        .update(salesLeads)
        .set({ status: plan.leadUpdate.status, updatedAt: now })
        .where(and(eq(salesLeads.id, leadId), eq(salesLeads.shopId, shopId)))
    }
    if (digits) {
      const plan = markDncPlan({ shopId, leadId, phoneDigits: digits })
      if (plan.dncInsert) {
        await db
          .insert(dncPhones)
          .values({
            shopId: plan.dncInsert.shopId,
            phoneDigits: plan.dncInsert.phoneDigits,
            reason: plan.dncInsert.reason,
            createdAt: now
          })
          .onConflictDoNothing()
      }
    }
    await log('dnc', 'Lead requested do not call')
    return { ok: true, message: 'Marked DNC' }
  }

  if (input.name === 'transfer_to_human') {
    const transferTo = process.env.SALES_TRANSFER_NUMBER?.trim()
    const callId = String(input.args.call_control_id || input.callControlId || '')
    if (!transferTo) {
      return { ok: false, message: 'SALES_TRANSFER_NUMBER is not configured' }
    }
    if (!callId) {
      return { ok: false, message: 'Missing call_control_id for transfer' }
    }
    const transferred = await transferCall(callId, transferTo)
    await log('in_progress', transferred.ok ? `Transferring to ${transferTo}` : transferred.error)
    await notifyShop(shopId, 'warm_transfer', { leadId, transferTo, callId })
    return transferred.ok
      ? { ok: true, message: 'Transfer started' }
      : { ok: false, message: transferred.error }
  }

  return { ok: false, message: `Unknown tool: ${input.name}` }
}

export async function addPhoneToDnc(shopId: string, phone: string, reason: string) {
  const normalized = normalizeUsPhone(phone)
  const digits = normalized.ok ? normalized.digits : phone.replace(/\D/g, '').slice(-10)
  if (!digits) return
  await db
    .insert(dncPhones)
    .values({
      shopId,
      phoneDigits: digits,
      reason,
      createdAt: Date.now()
    })
    .onConflictDoNothing()
}

export async function recordComplianceViolation(input: {
  shopId: string
  leadId?: string | null
  contactLogId?: number | null
  reason: string
  detail?: string
}) {
  await db.insert(complianceViolations).values({
    shopId: input.shopId,
    leadId: input.leadId || null,
    contactLogId: input.contactLogId || null,
    reason: input.reason,
    detail: input.detail || '',
    createdAt: Date.now()
  })
}

/** Upsert a sales lead from an inbound caller phone. */
export async function ensureInboundLead(shopId: string, fromPhone: string) {
  const normalized = normalizeUsPhone(fromPhone)
  if (!normalized.ok || !shopId) return null
  const now = Date.now()
  const [existing] = await db
    .select()
    .from(salesLeads)
    .where(and(eq(salesLeads.shopId, shopId), eq(salesLeads.phoneDigits, normalized.digits)))
    .limit(1)
  if (existing) {
    await db
      .update(salesLeads)
      .set({ lastContactedAt: now, updatedAt: now })
      .where(eq(salesLeads.id, existing.id))
    return existing.id
  }
  const id = `LEAD-IN-${normalized.digits}-${now}`
  await db.insert(salesLeads).values({
    id,
    shopId,
    businessName: 'Inbound caller',
    phone: normalized.formatted,
    phoneDigits: normalized.digits,
    address: '',
    website: null,
    rating: null,
    reviewCount: null,
    placeId: `inbound-${normalized.digits}`,
    source: 'inbound_call',
    campaign: '',
    status: 'contacted',
    notes: 'Created from inbound sales call',
    attempts: 1,
    retryAfter: null,
    createdAt: now,
    lastContactedAt: now,
    updatedAt: now
  })
  return id
}
