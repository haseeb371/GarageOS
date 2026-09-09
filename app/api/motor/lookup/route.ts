import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import {
  motorYears,
  motorMakes,
  motorModels,
  motorVehicles,
  motorAllData,
  motorVehicleByVin,
  motorConfigured
} from '@/lib/motor'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!motorConfigured()) {
    return NextResponse.json({ error: 'MOTOR API is not configured. Set MOTOR_API_PUBLIC_KEY and MOTOR_API_PRIVATE_KEY.' }, { status: 503 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'years'
  const year = Number(url.searchParams.get('year') || 0)
  const makeId = Number(url.searchParams.get('makeId') || 0)
  const modelId = Number(url.searchParams.get('modelId') || 0)
  const vin = url.searchParams.get('vin') || ''

  try {
    if (action === 'years') {
      return NextResponse.json({ ok: true, years: await motorYears() })
    }

    if (action === 'makes' && year) {
      return NextResponse.json({ ok: true, makes: await motorMakes(year) })
    }

    if (action === 'models' && year && makeId) {
      return NextResponse.json({ ok: true, models: await motorModels(year, makeId) })
    }

    if (action === 'vehicles' && year && makeId && modelId) {
      return NextResponse.json({ ok: true, vehicles: await motorVehicles(year, makeId, modelId) })
    }

    if (action === 'vin' && vin) {
      const vehicle = await motorVehicleByVin(vin)
      if (!vehicle) return NextResponse.json({ error: 'No vehicle found for this VIN.' }, { status: 404 })
      return NextResponse.json({ ok: true, vehicle })
    }

    if (action === 'all' && year && makeId && modelId) {
      const result = await motorAllData({ year, makeId, modelId })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
      return NextResponse.json({
        ok: true,
        baseVehicleId: result.baseVehicleId,
        labor: result.labor,
        maintenance: result.maintenance,
        fluids: result.fluids,
        source: 'MOTOR'
      })
    }

    return NextResponse.json({ error: 'Invalid lookup. Use action=years|makes|models|vehicles|vin|all with appropriate params.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'MOTOR lookup failed.' }, { status: 502 })
  }
}
