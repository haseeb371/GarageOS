import { NextResponse } from 'next/server'
import { motorConfigured } from '@/lib/motor'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = motorConfigured()
  return NextResponse.json({
    configured,
    provider: 'MOTOR',
    mode: configured ? 'Sandbox (public credentials)' : 'Not configured',
    message: configured
      ? 'MOTOR labor data is available. Use Labor & vehicle data → MOTOR lookup to search by year/make/model or VIN.'
      : 'Set MOTOR_API_PUBLIC_KEY and MOTOR_API_PRIVATE_KEY in .env.local to enable licensed labor times, maintenance, and fluid data.'
  })
}
