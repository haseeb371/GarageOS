import { NextResponse } from 'next/server'
import { z } from 'zod'
import { canWrite, currentUser } from '@/lib/auth'
import { createEstimateApprovalLink } from '@/lib/approvals'

const input = z.object({ orderId: z.string().trim().min(1), expiresInDays: z.number().int().min(1).max(30).default(7) })

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWrite(user.role)) return NextResponse.json({ error: 'Your role cannot share estimates.' }, { status: 403 })
  const parsed = input.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid approval-link request.' }, { status: 400 })
  try {
    const result = await createEstimateApprovalLink({ shopId: user.shopId, orderId: parsed.data.orderId, actorId: user.id, expiresInDays: parsed.data.expiresInDays })
    const origin = new URL(request.url).origin
    return NextResponse.json({ url: `${origin}/estimate/${result.token}`, expiresAt: result.expiresAt })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create approval link.' }, { status: 400 })
  }
}
