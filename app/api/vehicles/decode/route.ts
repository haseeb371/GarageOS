import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { canWrite, currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, records } from '@/lib/schema'

const input = z.object({ vehicleId: z.string().trim().min(1), vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Enter a valid 17-character VIN.') })
const value = (result: Record<string,string>, key: string) => result[key]?.trim() || ''

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWrite(user.role)) return NextResponse.json({ error: 'Your role cannot update vehicles.' }, { status: 403 })
  const parsed = input.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid VIN.' }, { status: 400 })
  const [row] = await db.select().from(records).where(and(eq(records.id, parsed.data.vehicleId), eq(records.kind, 'vehicles'), eq(records.shopId, user.shopId))).limit(1)
  if (!row) return NextResponse.json({ error: 'Vehicle not found.' }, { status: 404 })
  try {
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(parsed.data.vin)}?format=json`, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json', 'user-agent': 'GarageOS/1.0 VIN decoder' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`NHTSA returned ${response.status}.`)
    const body = await response.json() as { Results?: Record<string,string>[] }
    const decoded = body.Results?.[0]
    if (!decoded) throw new Error('NHTSA returned no vehicle data.')
    const errorCode = value(decoded, 'ErrorCode')
    if (errorCode && errorCode.split(',').some(code => code.trim() !== '0')) throw new Error(value(decoded, 'ErrorText') || 'The VIN could not be decoded.')
    const vehicle = JSON.parse(row.data) as Record<string,unknown>
    const updated = { ...vehicle, vin: parsed.data.vin, year: Number(value(decoded, 'ModelYear')) || vehicle.year, make: value(decoded, 'Make') || vehicle.make, model: value(decoded, 'Model') || vehicle.model,
      trim: value(decoded, 'Trim'), series: value(decoded, 'Series'), manufacturer: value(decoded, 'Manufacturer'), vehicleType: value(decoded, 'VehicleType'), bodyClass: value(decoded, 'BodyClass'),
      doors: Number(value(decoded, 'Doors')) || null, driveType: value(decoded, 'DriveType'), fuelType: value(decoded, 'FuelTypePrimary'), engineCylinders: Number(value(decoded, 'EngineCylinders')) || null,
      engineDisplacementL: Number(value(decoded, 'DisplacementL')) || null, engineModel: value(decoded, 'EngineModel'), transmissionStyle: value(decoded, 'TransmissionStyle'), transmissionSpeeds: Number(value(decoded, 'TransmissionSpeeds')) || null,
      plantCountry: value(decoded, 'PlantCountry'), gvwr: value(decoded, 'GVWR'), brakeSystem: value(decoded, 'BrakeSystemType'), decodedAt: new Date().toISOString(), decodeSource: 'NHTSA vPIC' }
    const now = Date.now()
    await db.transaction(async tx => {
      await tx.update(records).set({ data: JSON.stringify(updated), updatedAt: now }).where(and(eq(records.id, row.id), eq(records.shopId, user.shopId)))
      await tx.insert(auditLog).values({ actor: user.id, action: 'decode_vin', entity: 'vehicles', entityId: row.id, detail: `Decoded VIN through NHTSA vPIC: ${updated.year} ${updated.make} ${updated.model}`, createdAt: now })
    })
    return NextResponse.json({ vehicle: updated, source: 'NHTSA vPIC' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'VIN decoding failed.' }, { status: 502 })
  }
}
