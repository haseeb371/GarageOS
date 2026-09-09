import 'server-only'
import { createHmac } from 'crypto'

const BASE = 'https://api.motor.com/v1'

function keys() {
  const publicKey = process.env.MOTOR_API_PUBLIC_KEY || 'NQfWGktRwx'
  const privateKey = process.env.MOTOR_API_PRIVATE_KEY || 'h0dpvDe-oPtISJHQ5d7iv_0gZ'
  return { publicKey, privateKey }
}

export function motorConfigured() {
  return Boolean(keys().publicKey && keys().privateKey)
}

function sign(method: string, fullPath: string) {
  const { publicKey, privateKey } = keys()
  const unixTime = Math.floor(Date.now() / 1000)
  const pathOnly = fullPath.split('?')[0]
  const stringToSign = [publicKey, method.toUpperCase(), String(unixTime), pathOnly].join('\n')
  const sig = createHmac('sha256', privateKey).update(stringToSign).digest('base64')
  const urlSafe = sig.replace(/\+/g, '%2B').replace(/\//g, '%2F').replace(/=/g, '%3D')
  return { Authorization: `Shared ${publicKey}:${urlSafe}`, 'X-Date': String(unixTime) }
}

async function motorGet(path: string) {
  const authHeaders = sign('GET', path)
  const response = await fetch(`${BASE}${path}`, {
    headers: { ...authHeaders, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { ok: false as const, status: response.status, error: text || `MOTOR returned ${response.status}` }
  }
  const body = await response.json().catch(() => ({}))
  return { ok: true as const, data: body }
}

type MotorResponse = { ok: true; data: any } | { ok: false; status: number; error: string }

function extractApplications(res: MotorResponse): any[] {
  if (!res.ok) return []
  return res.data?.Body?.Applications || res.data?.Body?.Items || []
}

export type MotorYear = { YearID: number }
export type MotorMake = { MakeID: number; MakeName: string }
export type MotorModel = { ModelID: number; ModelName: string }
export type MotorVehicle = { BaseVehicleID: number; VehicleName?: string; EngineName?: string }

export async function motorYears(min = 1990, max?: number): Promise<MotorYear[]> {
  const maxYear = max || new Date().getFullYear() + 1
  const path = `/Information/YMME/Years?Min=${min}&Max=${maxYear}&VehicleTypes=1&AttributeStandard=MOTOR`
  const res = await motorGet(path)
  if (!res.ok) return []
  const items = res.data?.Body?.Years || res.data?.Body?.Items || []
  return items.map((y: any) => ({ YearID: Number(y.YearID || y.Year || y) })).filter((y: MotorYear) => y.YearID)
}

export async function motorMakes(year: number): Promise<MotorMake[]> {
  const path = `/Information/YMME/Years/${year}/Makes?AttributeStandard=MOTOR`
  const res = await motorGet(path)
  if (!res.ok) return []
  const items = res.data?.Body?.Makes || res.data?.Body?.Items || []
  return items.map((m: any) => ({ MakeID: Number(m.MakeID), MakeName: String(m.MakeName || m.Name || '') })).filter((m: MotorMake) => m.MakeID)
}

export async function motorModels(year: number, makeId: number): Promise<MotorModel[]> {
  const path = `/Information/YMME/Years/${year}/Makes/${makeId}/Models?AttributeStandard=MOTOR`
  const res = await motorGet(path)
  if (!res.ok) return []
  const items = res.data?.Body?.Models || res.data?.Body?.Items || []
  return items.map((m: any) => ({ ModelID: Number(m.ModelID), ModelName: String(m.ModelName || m.Name || '') })).filter((m: MotorModel) => m.ModelID)
}

export async function motorVehicles(year: number, makeId: number, modelId: number): Promise<MotorVehicle[]> {
  const path = `/Information/YMME/Years/${year}/Makes/${makeId}/Models/${modelId}/Vehicles?AttributeStandard=MOTOR`
  const res = await motorGet(path)
  if (!res.ok) return []
  const items = res.data?.Body?.Vehicles || res.data?.Body?.Items || []
  return items.map((v: any) => ({
    BaseVehicleID: Number(v.BaseVehicleID || v.VehicleID || v.ID),
    VehicleName: String(v.VehicleName || v.Name || ''),
    EngineName: String(v.EngineName || v.Engine || '')
  })).filter((v: MotorVehicle) => v.BaseVehicleID)
}

export async function motorBaseVehicleId(year: number, makeId: number, modelId: number): Promise<number | null> {
  const path = `/Information/YMME/Years/${year}/Makes/${makeId}/Models/${modelId}/BaseVehicle?AttributeStandard=MOTOR`
  const res = await motorGet(path)
  if (!res.ok) return null
  return Number(res.data?.Body?.BaseVehicleID || res.data?.Body?.BaseVehicle?.BaseVehicleID || 0) || null
}

export async function motorVehicleByVin(vin: string): Promise<MotorVehicle | null> {
  const path = `/Information/Vehicles/Search/ByVIN?VIN=${encodeURIComponent(vin.toUpperCase())}`
  const res = await motorGet(path)
  if (!res.ok) return null
  const items = res.data?.Body?.Vehicles || res.data?.Body?.Items || []
  const v = items[0]
  if (!v) return null
  return {
    BaseVehicleID: Number(v.BaseVehicleID || v.VehicleID || 0),
    VehicleName: String(v.VehicleName || v.Name || ''),
    EngineName: String(v.EngineName || v.Engine || '')
  }
}

export type MotorLabor = {
  EstimatedWorkTimeID: number
  Operation: string
  GroupName: string
  SubGroupName: string
  StandardHours: number
  WarrantyHours: number
  ServiceType: string
  Notes: string[]
}

export async function motorLaborTimes(baseVehicleId: number): Promise<MotorLabor[]> {
  const path = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Summaries/Of/EstimatedWorkTimes?AttributeStandard=MOTOR&ItemsPerPage=100`
  const res = await motorGet(path)
  const apps = extractApplications(res)
  const results: MotorLabor[] = []
  for (const app of apps) {
    const appId = Number(app.ApplicationID || 0)
    if (!appId) continue
    const detailPath = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Details/Of/EstimatedWorkTimes/${appId}?AttributeStandard=MOTOR`
    const detail = await motorGet(detailPath)
    if (!detail.ok) continue
    const items = detail.data?.Body?.InformationContentGroup?.EstimatedWorkTimes || []
    for (const ewt of items) {
      const tax = ewt.TaxonomyInfo || {}
      results.push({
        EstimatedWorkTimeID: Number(ewt.EstimatedWorkTimeID || 0),
        Operation: String(tax.CommonName || ewt.OperationName || tax.GroupName || ''),
        GroupName: String(tax.GroupName || tax.SystemName || ''),
        SubGroupName: String(tax.SubGroupName || ''),
        StandardHours: Number(ewt.BaseLaborTime || ewt.AllLaborTime || 0),
        WarrantyHours: Number(ewt.BaseWarrantyLaborTime || ewt.AllWarrantyLaborTime || 0),
        ServiceType: String(ewt.ServiceType || ''),
        Notes: Array.isArray(ewt.Notes) ? ewt.Notes.map((n: any) => String(n.Text || n.Note || n || '')) : []
      })
    }
  }
  return results.filter(r => r.Operation)
}

export type MotorMaintenance = {
  MaintenanceScheduleID: number
  Operation: string
  IntervalMile: number
  IntervalMonth: number
  FrequencyDescription: string
  Indicator: string
  Notes: string[]
}

export async function motorMaintenanceSchedules(baseVehicleId: number): Promise<MotorMaintenance[]> {
  const path = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Summaries/Of/MaintenanceSchedules?Severity=Normal&AttributeStandard=MOTOR&ItemsPerPage=100`
  const res = await motorGet(path)
  const apps = extractApplications(res)
  const results: MotorMaintenance[] = []
  for (const app of apps) {
    const appId = Number(app.ApplicationID || 0)
    if (!appId) continue
    const detailPath = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Details/Of/MaintenanceSchedules/${appId}?AttributeStandard=MOTOR`
    const detail = await motorGet(detailPath)
    if (!detail.ok) continue
    const items = detail.data?.Body?.InformationContentGroup?.MaintenanceSchedules || []
    for (const ms of items) {
      results.push({
        MaintenanceScheduleID: Number(ms.MaintenanceScheduleID || 0),
        Operation: String(ms.OperationName || ms.Description || ''),
        IntervalMile: Number(ms.IntervalMile || 0),
        IntervalMonth: Number(ms.IntervalMonth || 0),
        FrequencyDescription: String(ms.FrequencyDescription || ''),
        Indicator: String(ms.Indicator || ''),
        Notes: Array.isArray(ms.Notes) ? ms.Notes.map((n: any) => String(n.Text || n.Note || n || '')) : []
      })
    }
  }
  return results.filter(r => r.Operation || r.IntervalMile)
}

export type MotorFluid = {
  FluidID: number
  Name: string
  Quantity: number
  UnitOfMeasure: string
  Viscosity: string
  Grade: string
  Notes: string[]
}

export async function motorFluids(baseVehicleId: number): Promise<MotorFluid[]> {
  const path = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Summaries/Of/Fluids?Include=Capacities&AttributeStandard=MOTOR&ItemsPerPage=100`
  const res = await motorGet(path)
  const apps = extractApplications(res)
  const results: MotorFluid[] = []
  for (const app of apps) {
    const appId = Number(app.ApplicationID || 0)
    if (!appId) continue
    const detailPath = `/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Details/Of/Fluids/${appId}?AttributeStandard=MOTOR`
    const detail = await motorGet(detailPath)
    if (!detail.ok) continue
    const items = detail.data?.Body?.InformationContentGroup?.Fluids || []
    for (const f of items) {
      const caps = Array.isArray(f.Capacities) ? f.Capacities : []
      const cap = caps[0] || {}
      results.push({
        FluidID: Number(f.FluidID || 0),
        Name: String(f.FluidName || f.Name || cap.Name || ''),
        Quantity: Number(cap.Quantity || f.Quantity || 0),
        UnitOfMeasure: String(cap.UnitOfMeasure || f.UnitOfMeasure || ''),
        Viscosity: String(f.Viscosity || cap.Viscosity || ''),
        Grade: String(f.Grade || cap.Grade || ''),
        Notes: Array.isArray(f.Notes) ? f.Notes.map((n: any) => String(n.Text || n.Note || n || '')) : []
      })
    }
  }
  return results.filter(r => r.Name)
}

export async function motorAllData(vehicle: { year: number; makeId: number; modelId: number }) {
  const baseVehicleId = await motorBaseVehicleId(vehicle.year, vehicle.makeId, vehicle.modelId)
  if (!baseVehicleId) return { ok: false as const, error: 'Could not resolve BaseVehicleID for this vehicle.' }
  const [labor, maintenance, fluids] = await Promise.all([
    motorLaborTimes(baseVehicleId).catch(() => []),
    motorMaintenanceSchedules(baseVehicleId).catch(() => []),
    motorFluids(baseVehicleId).catch(() => [])
  ])
  return { ok: true as const, baseVehicleId, labor, maintenance, fluids }
}
