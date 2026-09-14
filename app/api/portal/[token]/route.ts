import { NextResponse } from 'next/server'
import { getCustomerPortal } from '@/lib/customerPortal'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token?.trim()) {
    return NextResponse.json({ error: 'Missing portal token.' }, { status: 400 })
  }
  const portal = await getCustomerPortal(token)
  if (portal.state === 'invalid') {
    return NextResponse.json({ state: 'invalid', error: 'This portal link is not valid.' }, { status: 404 })
  }
  if (portal.state === 'expired') {
    return NextResponse.json({ state: 'expired', error: 'This portal link has expired.' }, { status: 410 })
  }
  return NextResponse.json(portal)
}
