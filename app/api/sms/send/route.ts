import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { sendSms, normalizePhone } from '@/lib/sms'
import { campaignAudienceCount, campaignAudiencePreview, declinedWorkSegment, renderCampaignTemplate, simulateCampaignSend } from '@/lib/marketing'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  type: z.enum(['test', 'reminder', 'campaign']),
  reminderId: z.string().optional(),
  campaignId: z.string().optional(),
  to: z.string().optional()
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

function renderTemplate(template: string, customerName: string) {
  return renderCampaignTemplate(template, customerName)
}

async function logSmsActivity(shopId: string, note: string, ok: boolean) {
  const now = Date.now()
  const log = {
    id: `IT-${now}`,
    type: ok ? 'SMS sent' : 'SMS failed',
    itemId: 'sms',
    sku: '',
    itemName: 'Messaging',
    quantity: 0,
    note,
    createdAt: new Date().toISOString(),
    alertChannel: ok ? 'SMS live' : 'SMS failed',
    shopId
  }
  await db.insert(records).values({
    id: log.id,
    kind: 'inventoryTransactions',
    shopId,
    data: JSON.stringify(log),
    createdAt: now,
    updatedAt: now
  }).onConflictDoNothing()
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return responseError(`${user.role} access cannot send SMS.`, 403)
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid SMS request.')

  const data = await shopData(user.shopId)
  const shop = (data.shops || [])[0] || { name: 'AutoGaragify' }

  if (parsed.data.type === 'test') {
    const to = normalizePhone(parsed.data.to || '')
    if (!to) return responseError('Enter a phone number with country code, e.g. +15551234567.')
    const result = await sendSms({
      to,
      body: `AutoGaragify test SMS from ${shop.name || 'your shop'}. Twilio is connected.`
    })
    await logSmsActivity(
      user.shopId,
      result.ok
        ? `Test SMS sent to ${result.to} via Twilio${result.id ? ` (${result.id})` : ''}.`
        : `Test SMS failed for ${to}: ${result.error}`,
      result.ok
    )
    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
    return NextResponse.json({ ok: true, id: result.id, to: result.to, mode: 'live' })
  }

  if (parsed.data.type === 'reminder') {
    const reminder = (data.serviceReminders || []).find(row => row.id === parsed.data.reminderId)
    if (!reminder) return responseError('Reminder not found.')
    const customer = (data.customers || []).find(row => row.id === reminder.customerId)
    if (!customer) return responseError('Reminder customer not found.')
    if (customer.smsOptOut || customer.marketingOptOut) {
      return responseError('Customer opted out of SMS marketing/reminders.')
    }
    const to = normalizePhone(String(customer.phone || ''))
    if (!to) return responseError('Customer has no phone number. Add one with country code first.')

    const vehicle = (data.vehicles || []).find(row => row.id === reminder.vehicleId)
    const vehicleLabel = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'your vehicle'
    const body = `${shop.name || 'AutoGaragify'}: Reminder for ${customer.name || 'customer'} — ${reminder.service} is due${reminder.dueDate ? ` on ${reminder.dueDate}` : ''}${reminder.dueMileage ? ` / ${reminder.dueMileage} mi` : ''} (${vehicleLabel}). Reply or call to book.`

    const result = await sendSms({ to, body })
    const stamp = new Date().toISOString()
    if (result.ok) {
      const updated = {
        ...reminder,
        status: 'Sent',
        channel: 'SMS live',
        lastSentAt: stamp,
        shopId: user.shopId
      }
      await db.insert(records).values({
        id: reminder.id,
        kind: 'serviceReminders',
        shopId: user.shopId,
        data: JSON.stringify(updated),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }).onConflictDoUpdate({
        target: records.id,
        set: { data: JSON.stringify(updated), updatedAt: Date.now() }
      })
    }
    await logSmsActivity(
      user.shopId,
      result.ok
        ? `Reminder ${reminder.id} SMS sent to ${to} via Twilio${result.id ? ` (${result.id})` : ''}.`
        : `Reminder ${reminder.id} SMS failed for ${to}: ${result.error}`,
      result.ok
    )
    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)
    return NextResponse.json({ ok: true, id: result.id, to, mode: 'live' })
  }

  if (parsed.data.type === 'campaign') {
    const campaign = (data.campaigns || []).find(row => row.id === parsed.data.campaignId)
    if (!campaign) return responseError('Campaign not found.')
    const segment = declinedWorkSegment(data.orders || [], data.customers || [], data.vehicles || [])
    const preview = campaignAudiencePreview(
      { ...campaign, channel: 'SMS live' },
      data.customers || [],
      segment
    )
    if (!preview.reachable) {
      return responseError(
        preview.total
          ? `No reachable SMS recipients (${preview.skipped} skipped for opt-out or missing phone).`
          : 'Campaign has no audience.'
      )
    }

    const template = String(campaign.template || 'A previously recommended service is ready when you are.')
    const sentTo: string[] = []
    const failures: string[] = []

    for (const row of preview.rows) {
      if (!row.reachable) {
        failures.push(`${row.name}: ${row.skippedReason}`)
        continue
      }
      const to = normalizePhone(row.phone)
      const body = `${shop.name || 'AutoGaragify'}: ${renderTemplate(template, row.name)}`
      const result = await sendSms({ to, body })
      if (result.ok) sentTo.push(to)
      else failures.push(`${row.name}: ${result.error}`)
    }

    if (!sentTo.length) {
      await logSmsActivity(user.shopId, `Campaign ${campaign.id} SMS failed: ${failures.join('; ')}`, false)
      return responseError(failures[0] || 'No campaign SMS messages were sent.')
    }

    const updated = {
      ...simulateCampaignSend(campaign, segment, sentTo.length),
      channel: 'SMS live',
      sent: Number(campaign.sent || 0) + sentTo.length,
      shopId: user.shopId
    }
    await db.insert(records).values({
      id: campaign.id,
      kind: 'campaigns',
      shopId: user.shopId,
      data: JSON.stringify(updated),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }).onConflictDoUpdate({
      target: records.id,
      set: { data: JSON.stringify(updated), updatedAt: Date.now() }
    })

    await logSmsActivity(
      user.shopId,
      `Campaign ${campaign.id} SMS sent to ${sentTo.length} recipient(s)${failures.length ? `; ${failures.length} skipped/failed` : ''}.`,
      true
    )

    return NextResponse.json({
      ok: true,
      mode: 'live',
      sent: sentTo.length,
      failed: failures.length,
      failures,
      audience: campaignAudienceCount(campaign, segment)
    })
  }

  return responseError('Unsupported SMS type.')
}
