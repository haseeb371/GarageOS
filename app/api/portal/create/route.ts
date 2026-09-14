import { NextResponse } from 'next/server'
import { z } from 'zod'
import { canWrite, currentUser } from '@/lib/auth'
import { createCustomerPortalLink } from '@/lib/customerPortal'

const input = z.object({
  orderId: z.string().trim().min(1),
  expiresInDays: z.number().int().min(1).max(30).default(14)
})

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: 'Your role cannot share customer portal links.' }, { status: 403 })
  }
  const parsed = input.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid portal-link request.' }, { status: 400 })
  }
  try {
    const result = await createCustomerPortalLink({
      shopId: user.shopId,
      orderId: parsed.data.orderId,
      actorId: user.id,
      expiresInDays: parsed.data.expiresInDays
    })
    const origin = new URL(request.url).origin
    return NextResponse.json({
      url: `${origin}/portal/${result.token}`,
      expiresAt: result.expiresAt
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create portal link.' },
      { status: 400 }
    )
  }
}
