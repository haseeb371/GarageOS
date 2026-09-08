type Row = Record<string, unknown> & { id: string }

export type LaborGuideTemplate = {
  operation: string
  system: string
  standardHours: number
  warrantyHours: number
  notes: string
}

/** Shop reference times — not licensed MOTOR/AllData content. */
export const LABOR_REFERENCE_PACK: LaborGuideTemplate[] = [
  { operation: 'Engine oil and filter service', system: 'Lube', standardHours: 0.5, warrantyHours: 0.4, notes: 'Includes drain, filter, refill, reset reminder if equipped.' },
  { operation: 'Rotate and balance four tires', system: 'Tires', standardHours: 1.0, warrantyHours: 0.8, notes: 'Road-force balance if shop equipped.' },
  { operation: 'Replace cabin air filter', system: 'HVAC', standardHours: 0.4, warrantyHours: 0.3, notes: 'Access varies by model.' },
  { operation: 'Replace engine air filter', system: 'Engine', standardHours: 0.3, warrantyHours: 0.2, notes: '' },
  { operation: 'Front brake pads and rotors', system: 'Brakes', standardHours: 2.2, warrantyHours: 1.8, notes: 'Both sides; verify ABS tone rings.' },
  { operation: 'Rear brake pads and rotors', system: 'Brakes', standardHours: 2.0, warrantyHours: 1.6, notes: 'Both sides; electronic parking brake may add time.' },
  { operation: 'Brake fluid exchange', system: 'Brakes', standardHours: 1.0, warrantyHours: 0.8, notes: 'Pressure or vacuum bleed.' },
  { operation: 'Battery test and replacement', system: 'Electrical', standardHours: 0.6, warrantyHours: 0.5, notes: 'Includes registration where required.' },
  { operation: 'Alternator replacement', system: 'Electrical', standardHours: 2.5, warrantyHours: 2.0, notes: 'Serpentine belt inspection recommended.' },
  { operation: 'Starter replacement', system: 'Electrical', standardHours: 2.0, warrantyHours: 1.6, notes: '' },
  { operation: 'Spark plugs (4-cylinder)', system: 'Ignition', standardHours: 1.2, warrantyHours: 1.0, notes: 'Coil-on-plug; gap and torque per spec.' },
  { operation: 'Spark plugs (V6)', system: 'Ignition', standardHours: 2.0, warrantyHours: 1.6, notes: 'Bank access may vary.' },
  { operation: 'Coolant system flush', system: 'Cooling', standardHours: 1.5, warrantyHours: 1.2, notes: 'Includes thermostat check.' },
  { operation: 'Thermostat replacement', system: 'Cooling', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'Water pump replacement', system: 'Cooling', standardHours: 3.5, warrantyHours: 2.8, notes: 'Often bundled with timing service on some engines.' },
  { operation: 'Serpentine belt replacement', system: 'Engine', standardHours: 0.8, warrantyHours: 0.6, notes: 'Inspect tensioner and pulleys.' },
  { operation: 'Timing belt service', system: 'Engine', standardHours: 6.0, warrantyHours: 5.0, notes: 'Include water pump/seals if applicable.' },
  { operation: 'Transmission fluid service', system: 'Drivetrain', standardHours: 1.5, warrantyHours: 1.2, notes: 'Filter where accessible.' },
  { operation: 'Four-wheel alignment', system: 'Steering', standardHours: 1.5, warrantyHours: 1.2, notes: 'After suspension or tire work.' },
  { operation: 'Front strut assembly (one side)', system: 'Suspension', standardHours: 1.8, warrantyHours: 1.5, notes: 'Alignment recommended after.' },
  { operation: 'Wheel bearing hub (one side)', system: 'Suspension', standardHours: 1.5, warrantyHours: 1.2, notes: '' },
  { operation: 'A/C performance check and recharge', system: 'HVAC', standardHours: 1.2, warrantyHours: 1.0, notes: 'Leak diagnosis billed separately if found.' },
  { operation: 'Diagnostic / check engine light', system: 'Diagnostics', standardHours: 1.0, warrantyHours: 0.8, notes: 'Base scan and road test; deeper diagnosis may add time.' },
  { operation: 'Pre-purchase inspection', system: 'Inspection', standardHours: 1.5, warrantyHours: 1.2, notes: 'Multi-point with written findings.' }
]

export function laborCsvTemplate() {
  return [
    'operation,system,standardHours,warrantyHours,notes',
    ...LABOR_REFERENCE_PACK.map(
      row =>
        `"${row.operation.replaceAll('"', '""')}","${row.system}",${row.standardHours},${row.warrantyHours},"${row.notes.replaceAll('"', '""')}"`
    )
  ].join('\n')
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

export function parseLaborGuideCsv(csv: string) {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return { ok: false as const, error: 'CSV needs a header row and at least one data row.', rows: [] as LaborGuideTemplate[] }

  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const operationIdx = idx(['operation', 'op', 'job', 'name', 'description'])
  const systemIdx = idx(['system', 'category', 'group'])
  const standardIdx = idx(['standardhours', 'hours', 'laborhours', 'time'])
  const warrantyIdx = idx(['warrantyhours', 'warranty'])
  const notesIdx = idx(['notes', 'note', 'comment'])

  if (operationIdx < 0 || standardIdx < 0) {
    return {
      ok: false as const,
      error: 'CSV header must include operation and standardHours columns (aliases: job/name, hours/laborHours).',
      rows: [] as LaborGuideTemplate[]
    }
  }

  const rows: LaborGuideTemplate[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const operation = cells[operationIdx] || ''
    const standardHours = Number(cells[standardIdx] || 0)
    if (!operation || !Number.isFinite(standardHours) || standardHours <= 0) continue
    rows.push({
      operation,
      system: systemIdx >= 0 ? cells[systemIdx] || 'General' : 'General',
      standardHours,
      warrantyHours: warrantyIdx >= 0 ? Number(cells[warrantyIdx] || standardHours) || standardHours : standardHours,
      notes: notesIdx >= 0 ? cells[notesIdx] || '' : ''
    })
  }

  if (!rows.length) return { ok: false as const, error: 'No valid labor rows found in the CSV.', rows: [] as LaborGuideTemplate[] }
  return { ok: true as const, rows }
}

export function entriesFromTemplates(
  templates: LaborGuideTemplate[],
  options: { vehicleId?: string; source: string; sourceReference?: string; shopId: string }
) {
  const stamp = Date.now()
  return templates.map((template, index) => {
    const id = `LG-${String(stamp).slice(-6)}-${index + 1}`
    return {
      id,
      vehicleId: options.vehicleId || '',
      operation: template.operation,
      system: template.system,
      standardHours: template.standardHours,
      warrantyHours: template.warrantyHours,
      source: options.source,
      sourceReference: options.sourceReference || '',
      notes: template.notes,
      shopId: options.shopId
    } satisfies Row
  })
}

export function jobFromLaborGuide(entry: Row, laborRate: number) {
  const hours = Number(entry.standardHours || 0)
  return {
    id: `J-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    type: String(entry.system || 'Labor guide'),
    name: String(entry.operation || 'Labor operation'),
    description: String(entry.notes || `Labor guide · ${entry.source || 'Shop'}`),
    laborHours: hours,
    laborRate,
    partsCost: 0,
    partsPrice: 0,
    decision: 'Pending',
    severity: 'Standard',
    laborGuideId: entry.id,
    source: entry.source
  }
}

export function defaultLaborRate(pricingRules: Row[] = []) {
  const rule = pricingRules.find(r => r.active !== false && String(r.type) === 'Labor rate')
  return Number(rule?.amount || 140)
}
