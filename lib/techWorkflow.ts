type Row = Record<string, unknown> & { id: string }

export type TechAssignmentAction = 'start' | 'pause' | 'complete'

export function assignmentElapsedMinutes(assignment: Row, now = Date.now()) {
  const base = Number(assignment.accumulatedMinutes || 0)
  if (assignment.status === 'In progress' && assignment.timerStartedAt) {
    const started = new Date(String(assignment.timerStartedAt)).getTime()
    if (Number.isFinite(started)) return base + Math.max(0, (now - started) / 60000)
  }
  return base
}

export function applyAssignmentAction(assignment: Row, action: TechAssignmentAction, now = Date.now()) {
  const stamp = new Date(now).toISOString()
  const elapsed = assignmentElapsedMinutes(assignment, now)
  if (action === 'start') {
    if (assignment.status === 'Completed') throw new Error('This job is already completed.')
    if (assignment.status === 'In progress') throw new Error('Timer is already running.')
    return {
      ...assignment,
      status: 'In progress',
      accumulatedMinutes: Number(assignment.accumulatedMinutes || 0),
      timerStartedAt: stamp,
      completedAt: null
    }
  }
  if (action === 'pause') {
    if (assignment.status !== 'In progress') throw new Error('Only a running job can be paused.')
    return {
      ...assignment,
      status: 'Paused',
      accumulatedMinutes: elapsed,
      timerStartedAt: null
    }
  }
  if (action === 'complete') {
    if (assignment.status === 'Completed') throw new Error('This job is already completed.')
    return {
      ...assignment,
      status: 'Completed',
      accumulatedMinutes: assignment.status === 'In progress' ? elapsed : Number(assignment.accumulatedMinutes || 0),
      timerStartedAt: null,
      completedAt: stamp
    }
  }
  throw new Error('Unknown timer action.')
}

export function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(2)}h`
}

export const TECH_INSPECTION_POINTS: Array<[string, string]> = [
  ['Tires and wheels', 'Tread depth / pressure'],
  ['Front brake system', 'Pad and rotor condition'],
  ['Rear brake system', 'Pad and rotor condition'],
  ['Fluids and leaks', 'Levels and visible leaks'],
  ['Battery and charging', 'Voltage and terminal condition'],
  ['Lights and visibility', 'Lamps, glass and wipers'],
  ['Steering and suspension', 'Play, wear and damage'],
  ['Underbody and exhaust', 'Leaks, corrosion and mounting']
]

export function buildDraftInspection(orderId: string, technician: string) {
  return {
    id: `DVI-${Date.now().toString().slice(-6)}`,
    orderId,
    template: 'Bay safety inspection',
    technician,
    date: new Date().toISOString().slice(0, 10),
    status: 'In progress',
    odometer: '',
    customerNotes: '',
    completedAt: null,
    items: TECH_INSPECTION_POINTS.map(([area, guidance], index) => ({
      id: `I-${index + 1}`,
      area,
      guidance,
      result: 'Not inspected',
      note: '',
      measurement: '',
      attachments: [],
      recommended: false
    }))
  }
}
