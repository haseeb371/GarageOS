import 'server-only'
import { and, asc, count, eq, gte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { contactLogs, dncPhones, notifications, salesCampaigns, salesLeads } from '@/lib/schema'
import { e164FromStoredPhone } from '@/lib/leads'
import {
  dialerDailyCap,
  dialerMaxConcurrent,
  getActiveDialCount,
  isDialerEnabled,
  runDialerGuards,
  trackDialEnd,
  trackDialStart,
  usStateBlocklist
} from '@/lib/dialerGuards'
import { isDryRun } from '@/lib/config'
import { placeOutboundCall, telnyxConfigured } from '@/lib/telnyx'
import { buildDryRunContactLog, shouldSkipTelnyxCall } from '@/lib/dialerDryRun'

export async function startCampaign(campaignName: string, shopId: string) {
  const name = campaignName.trim()
  if (!name) return { ok: false as const, error: 'Campaign name is required.' }

  const now = Date.now()
  const id = `CMP-${shopId.slice(0, 6)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${String(now).slice(-4)}`

  const leads = await db
    .select()
    .from(salesLeads)
    .where(
      and(
        eq(salesLeads.shopId, shopId),
        eq(salesLeads.status, 'new'),
        or(eq(salesLeads.campaign, name), eq(salesLeads.campaign, ''))
      )
    )
    .limit(dialerDailyCap())

  await db.transaction(async tx => {
    for (const lead of leads) {
      if (lead.campaign !== name) {
        await tx
          .update(salesLeads)
          .set({ campaign: name, updatedAt: now })
          .where(eq(salesLeads.id, lead.id))
      }
    }
    await tx.insert(salesCampaigns).values({
      id,
      shopId,
      name,
      status: 'running',
      totalLeads: leads.length,
      dialed: 0,
      interested: 0,
      converted: 0,
      createdAt: now,
      startedAt: now,
      endedAt: null,
      updatedAt: now
    })
  })

  return { ok: true as const, campaignId: id, assigned: leads.length, name }
}

async function dailyDialCount(shopId: string) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const [row] = await db
    .select({ value: count() })
    .from(contactLogs)
    .where(
      and(
        eq(contactLogs.shopId, shopId),
        eq(contactLogs.direction, 'outbound'),
        gte(contactLogs.createdAt, start.getTime())
      )
    )
  return Number(row?.value || 0)
}

function logGuardChecks(checks: ReturnType<typeof runDialerGuards>['checks']) {
  for (const row of checks) {
    console.log(JSON.stringify({ scope: 'dialer_guard', ...row }))
  }
}

export async function runDialerTick(shopId: string) {
  if (!isDialerEnabled()) {
    console.log('[dialer] DIALER_ENABLED=false — tick no-op')
    return { ok: true as const, dialed: 0, skipped: 'disabled' as const }
  }

  const dryRun = isDryRun()
  if (!dryRun && !telnyxConfigured()) {
    console.log('[dialer] Telnyx not configured — tick no-op')
    return { ok: true as const, dialed: 0, skipped: 'telnyx' as const }
  }

  const block = usStateBlocklist()
  if (block.length === 0) {
    console.log('[dialer] US_STATE_BLOCKLIST is empty (enforced, no states blocked yet)')
  }

  const active = getActiveDialCount()
  if (active >= dialerMaxConcurrent()) {
    return { ok: true as const, dialed: 0, skipped: 'concurrency' as const }
  }
  const daily = await dailyDialCount(shopId)
  if (daily >= dialerDailyCap()) {
    return { ok: true as const, dialed: 0, skipped: 'daily_cap' as const }
  }

  const dncRows = await db.select().from(dncPhones).where(eq(dncPhones.shopId, shopId))
  const dncDigits = new Set(dncRows.map(r => r.phoneDigits))

  const [campaign] = await db
    .select()
    .from(salesCampaigns)
    .where(and(eq(salesCampaigns.shopId, shopId), eq(salesCampaigns.status, 'running')))
    .orderBy(asc(salesCampaigns.startedAt))
    .limit(1)

  const campaignName = campaign?.name || ''
  const candidates = await db
    .select()
    .from(salesLeads)
    .where(
      and(
        eq(salesLeads.shopId, shopId),
        campaignName ? eq(salesLeads.campaign, campaignName) : sql`true`,
        or(eq(salesLeads.status, 'new'), eq(salesLeads.status, 'contacted'))
      )
    )
    .orderBy(asc(salesLeads.createdAt))
    .limit(25)

  let dialed = 0
  for (const lead of candidates) {
    if (getActiveDialCount() >= dialerMaxConcurrent()) break
    if (daily + dialed >= dialerDailyCap()) break

    const guard = runDialerGuards(
      {
        id: lead.id,
        status: lead.status,
        phoneDigits: lead.phoneDigits,
        address: lead.address,
        lastContactedAt: lead.lastContactedAt,
        retryAfter: lead.retryAfter,
        attempts: lead.attempts
      },
      { activeCount: getActiveDialCount(), dailyCount: daily + dialed, dncDigits }
    )
    logGuardChecks(guard.checks)
    if (!guard.ok) continue

    const to = e164FromStoredPhone(lead.phone)
    const now = Date.now()

    if (shouldSkipTelnyxCall(dryRun)) {
      console.log(
        JSON.stringify({
          scope: 'dialer_dry_run',
          lead_id: lead.id,
          to,
          campaign: lead.campaign,
          would_dial: true
        })
      )
      const dry = buildDryRunContactLog({
        shopId,
        leadId: lead.id,
        to,
        campaign: lead.campaign,
        now
      })
      await db.insert(contactLogs).values({
        ...dry,
        telnyxCallId: null,
        transcript: [],
        recordingUrl: null,
        durationSeconds: null,
        updatedAt: now
      })
      dialed += 1
      break
    }

    const placed = await placeOutboundCall(to, lead.id, shopId, lead.campaign)

    if (!placed.ok) {
      const attempts = (lead.attempts || 0) + 1
      await db
        .update(salesLeads)
        .set({
          attempts,
          retryAfter: now + 60 * 60 * 1000,
          status: attempts >= 3 ? 'failed' : lead.status,
          updatedAt: now
        })
        .where(eq(salesLeads.id, lead.id))
      await db.insert(contactLogs).values({
        shopId,
        leadId: lead.id,
        actorId: 'dialer',
        outcome: 'failed',
        detail: placed.error,
        direction: 'outbound',
        telnyxCallId: null,
        status: 'failed',
        transcript: [],
        recordingUrl: null,
        durationSeconds: null,
        aiDisclosure: true,
        endedAt: now,
        createdAt: now,
        updatedAt: now
      })
      continue
    }

    trackDialStart(placed.callControlId)
    await db
      .update(salesLeads)
      .set({
        status: 'contacted',
        lastContactedAt: now,
        attempts: (lead.attempts || 0) + 1,
        updatedAt: now
      })
      .where(eq(salesLeads.id, lead.id))
    await db.insert(contactLogs).values({
      shopId,
      leadId: lead.id,
      actorId: 'dialer',
      outcome: 'dialing',
      detail: `Outbound AI dial · campaign=${lead.campaign || ''}`,
      direction: 'outbound',
      telnyxCallId: placed.callControlId,
      status: 'dialing',
      transcript: [],
      recordingUrl: null,
      durationSeconds: null,
      aiDisclosure: true,
      endedAt: null,
      createdAt: now,
      updatedAt: now
    })
    if (campaign) {
      await db
        .update(salesCampaigns)
        .set({ dialed: (campaign.dialed || 0) + 1, updatedAt: now })
        .where(eq(salesCampaigns.id, campaign.id))
    }
    dialed += 1
    break
  }

  return {
    ok: true as const,
    dialed,
    dryRun,
    skipped: dialed ? undefined : ('none_eligible' as const)
  }
}

export function releaseDial(callId: string) {
  trackDialEnd(callId)
}

async function notifyCampaign(shopId: string, type: string, payload: Record<string, unknown>) {
  await db.insert(notifications).values({
    id: `NTF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    shopId,
    type,
    payload,
    createdAt: Date.now(),
    readAt: null
  })
}

export async function setCampaignStatus(
  shopId: string,
  campaignId: string,
  status: 'running' | 'paused' | 'done' | 'draft'
) {
  const now = Date.now()
  const patch: {
    status: string
    updatedAt: number
    startedAt?: number
    endedAt?: number | null
  } = {
    status,
    updatedAt: now,
    endedAt: status === 'done' ? now : null
  }
  if (status === 'running') patch.startedAt = now
  await db
    .update(salesCampaigns)
    .set(patch)
    .where(and(eq(salesCampaigns.id, campaignId), eq(salesCampaigns.shopId, shopId)))
  await notifyCampaign(shopId, `campaign_${status}`, { campaignId, status })
  return { ok: true as const }
}

export async function assignLeadsToCampaign(shopId: string, leadIds: string[], campaignName: string) {
  const name = campaignName.trim()
  if (!name || !leadIds.length) return { ok: false as const, error: 'Campaign name and leads are required.' }
  const now = Date.now()
  for (const id of leadIds) {
    await db
      .update(salesLeads)
      .set({ campaign: name, updatedAt: now })
      .where(and(eq(salesLeads.id, id), eq(salesLeads.shopId, shopId)))
  }
  return { ok: true as const, assigned: leadIds.length, name }
}
