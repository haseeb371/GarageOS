import { NextRequest, NextResponse } from 'next/server'

function hostMatch(headerValue: string, host: string): boolean {
  if (!headerValue) return false
  try {
    return new URL(headerValue).host === host
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return NextResponse.next()
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const origin = req.headers.get('origin') || ''
  const referer = req.headers.get('referer') || ''

  let allowed = hostMatch(origin, host) || hostMatch(referer, host)
  const hasSession = Boolean(req.cookies.get('autogragify_session')?.value)
  if (!allowed && !hasSession && !origin && !referer) allowed = true

  if (!allowed) {
    return NextResponse.json({ error: 'Request blocked: origin verification failed.' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*']
}
