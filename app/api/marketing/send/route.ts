import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { sendSms, normalizePhone, smsConfigured } from '@/lib/sms'
import { sendEmail, emailConfigured } from '@/lib/email'
import {
  campaignAudiencePreview,
  declinedWorkSegment,
  renderCampaignTemplate,
  simulateCampaignSend
} from '@/lib/marketing'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  campaignId: z.string().min(1),
  dryRun: z.boolean().optional().default(false)
})

async function shopData(shopId: string) {
  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(grouped[row.kind] ||= []).push(data)
  }
  return grouped
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function persistCampaign(shopId: string, campaign: Row) {
  const now = Date.now()
  await db
    .insert(records)
    .values({
      id: campaign.id,
      kind: 'campaigns',
      shopId,
      data: JSON.stringify({ ...campaign, shopId }),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: records.id,
      set: { data: JSON.stringify({ ...campaign, shopId }), updatedAt: now }
    })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return responseError(`${user.role} access cannot send campaigns.`, 403)
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid campaign send.')

  const data = await shopData(user.shopId)
  const campaign = (data.campaigns || []).find(row => row.id === parsed.data.campaignId)
  if (!campaign) return responseError('Campaign not found.')

  const segment = declinedWorkSegment(data.orders || [], data.customers || [], data.vehicles || [])
  const preview = campaignAudiencePreview(campaign, data.customers || [], segment)
  const shop = (data.shops || [])[0] || { name: 'AutoGragify' }

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      mode: preview.kind,
      ...preview,
      providerReady: preview.kind === 'sms' ? smsConfigured() : preview.kind === 'email' ? emailConfigured() : false
    })
  }

  if (!preview.reachable) {
    return responseError(
      preview.total
        ? `No reachable recipients (${preview.skipped} skipped for opt-out or missing contact).`
        : 'Campaign has no audience.'
    )
  }

  if (preview.kind === 'other') {
    return responseError('Choose SMS or Email as the campaign channel before sending.')
  }

  const template = String(campaign.template || 'A previously recommended service is ready when you are.')
  const results: Array<{ customerId: string; name: string; status: string; detail: string }> = []
  let sent = 0
  let failed = 0
  let mode: 'live' | 'sandbox' = 'live'

  for (const row of preview.rows) {
    if (!row.reachable) {
      results.push({ customerId: row.customerId, name: row.name, status: 'skipped', detail: row.skippedReason })
      continue
    }

    const bodyText = renderCampaignTemplate(template, row.name)

    if (preview.kind === 'sms') {
      const to = normalizePhone(row.phone)
      const result = await sendSms({
        to,
        body: `${shop.name || 'AutoGragify'}: ${bodyText}`
      })
      if (result.sandbox) mode = 'sandbox'
      if (result.ok) {
        sent++
        results.push({ customerId: row.customerId, name: row.name, status: 'sent', detail: to })
      } else {
        failed++
        results.push({ customerId: row.customerId, name: row.name, status: 'failed', detail: result.error })
      }
      continue
    }

    const html = `<p>${bodyText.replaceAll('\n', '<br/>')}</p><p style="color:#63716b;font-size:13px">${shop.name || 'AutoGragify'} · Reply to this email or call the shop to schedule.</p><p style="color:#63716b;font-size:12px">Reply STOP-equivalent: ask the shop to opt you out of marketing email.</p>`
    const result = await sendEmail({
      to: row.email,
      subject: `${shop.name || 'AutoGragify'} · ${campaign.name || 'Service follow-up'}`,
      html,
      text: bodyText
    })
    if (result.sandbox) mode = 'sandbox'
    if (result.ok) {
      sent++
      results.push({ customerId: row.customerId, name: row.name, status: 'sent', detail: row.email })
    } else {
      failed++
      results.push({ customerId: row.customerId, name: row.name, status: 'failed', detail: result.error })
    }
  }

  if (!sent) {
    return responseError(
      results.find(row => row.status === 'failed')?.detail || 'No campaign messages were sent.',
      mode === 'sandbox' ? 503 : 400
    )
  }

  const channelLabel =
    preview.kind === 'sms'
      ? mode === 'live'
        ? 'SMS live'
        : 'SMS sandbox'
      : mode === 'live'
        ? 'Email live'
        : 'Email sandbox'

  const updated = {
    ...simulateCampaignSend(campaign, segment, sent),
    channel: channelLabel,
    lastSendSummary: {
      at: new Date().toISOString(),
      mode,
      sent,
      failed,
      skipped: preview.skipped,
      audience: preview.total
    },
    shopId: user.shopId
  }
  await persistCampaign(user.shopId, updated)

  return NextResponse.json({
    ok: true,
    mode,
    channel: channelLabel,
    sent,
    failed,
    skipped: preview.skipped,
    audience: preview.total,
    results
  })
}
