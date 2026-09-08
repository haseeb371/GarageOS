import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'
import { sendSms, normalizePhone } from '@/lib/sms'
import { sendEmail } from '@/lib/email'
import { isEmailOptedOut, isSmsOptedOut } from '@/lib/marketing'
import {
  buildReviewRequestMessage,
  preferredReviewUrl,
  shopReviewLinks
} from '@/lib/reviews'

type Row = Record<string, unknown> & { id: string }

const payload = z.object({
  customerId: z.string().min(1),
  platform: z.enum(['google', 'yelp', 'auto']).optional().default('auto'),
  channel: z.enum(['sms', 'email', 'copy']).optional().default('copy')
})

async function shopData(shopId: string) {
  const rows = await db.select().from(records).where(eq(records.shopId, shopId))
  const grouped: Record<string, Row[]> = {}
  for (const row of rows) {
    const data = JSON.parse(row.data) as Row
    ;(grouped[row.kind] ||= []).push(data)
  }
  return { rows, grouped }
}

function responseError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return responseError('Unauthorized', 401)
  if (!['Owner', 'Manager', 'Advisor'].includes(user.role)) {
    return responseError(`${user.role} access cannot send review requests.`, 403)
  }

  const parsed = payload.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message || 'Invalid review request.')

  const { grouped } = await shopData(user.shopId)
  const shop = (grouped.shops || [])[0]
  const customer = (grouped.customers || []).find(row => row.id === parsed.data.customerId)
  if (!customer) return responseError('Customer not found.')

  const reviewUrl = preferredReviewUrl(shop, parsed.data.platform)
  if (!reviewUrl) {
    return responseError(
      'Add a Google or Yelp review URL on your shop location (Marketing → Reviews → Review links).'
    )
  }

  const links = shopReviewLinks(shop)
  const platformLabel =
    parsed.data.platform === 'yelp' || (!links.google && links.yelp)
      ? 'Yelp'
      : parsed.data.platform === 'google' || links.google
        ? 'Google'
        : 'online'

  const message = buildReviewRequestMessage({
    customerName: String(customer.name || 'there'),
    shopName: String(shop?.name || 'AutoGragify'),
    reviewUrl,
    platform: platformLabel
  })

  if (parsed.data.channel === 'copy') {
    return NextResponse.json({ ok: true, mode: 'copy', message, reviewUrl, platform: platformLabel })
  }

  if (parsed.data.channel === 'sms') {
    if (isSmsOptedOut(customer)) return responseError('Customer opted out of SMS.')
    const to = normalizePhone(String(customer.phone || ''))
    if (!to) return responseError('Customer has no phone number.')
    const result = await sendSms({ to, body: message })
    if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)

    const now = Date.now()
    const review = {
      id: `RV-${String(now).slice(-6)}`,
      customerId: customer.id,
      customer: customer.name,
      rating: 0,
      text: '',
      source: platformLabel,
      status: 'Request sent',
      response: '',
      reviewedAt: new Date().toISOString().slice(0, 10),
      requestChannel: 'SMS',
      requestUrl: reviewUrl,
      shopId: user.shopId
    }
    await db.insert(records).values({
      id: review.id,
      kind: 'reviews',
      shopId: user.shopId,
      data: JSON.stringify(review),
      createdAt: now,
      updatedAt: now
    })
    await db.insert(auditLog).values({
      actor: user.id,
      action: 'reviews.request',
      entity: 'reviews',
      entityId: review.id,
      detail: `SMS review request to ${to} (${platformLabel})`,
      createdAt: now
    })
    return NextResponse.json({ ok: true, mode: 'live', channel: 'sms', to, reviewId: review.id, reviewUrl })
  }

  if (isEmailOptedOut(customer)) return responseError('Customer opted out of email.')
  const to = String(customer.email || '').trim()
  if (!to) return responseError('Customer has no email address.')
  const result = await sendEmail({
    to,
    subject: `Thanks from ${shop?.name || 'AutoGragify'} — leave a quick review?`,
    html: `<p>${message.replace(reviewUrl, `<a href="${reviewUrl}">${reviewUrl}</a>`)}</p>`,
    text: message
  })
  if (!result.ok) return responseError(result.error, result.sandbox ? 503 : 400)

  const now = Date.now()
  const review = {
    id: `RV-${String(now).slice(-6)}`,
    customerId: customer.id,
    customer: customer.name,
    rating: 0,
    text: '',
    source: platformLabel,
    status: 'Request sent',
    response: '',
    reviewedAt: new Date().toISOString().slice(0, 10),
    requestChannel: 'Email',
    requestUrl: reviewUrl,
    shopId: user.shopId
  }
  await db.insert(records).values({
    id: review.id,
    kind: 'reviews',
    shopId: user.shopId,
    data: JSON.stringify(review),
    createdAt: now,
    updatedAt: now
  })
  await db.insert(auditLog).values({
    actor: user.id,
    action: 'reviews.request',
    entity: 'reviews',
    entityId: review.id,
    detail: `Email review request to ${to} (${platformLabel})`,
    createdAt: now
  })
  return NextResponse.json({ ok: true, mode: 'live', channel: 'email', to, reviewId: review.id, reviewUrl })
}
