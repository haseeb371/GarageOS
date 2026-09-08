type Row = Record<string, unknown> & { id: string }

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function parseDaySet(days: string) {
  if (!days || days === 'Every day') return new Set(dayNames)
  if (days === 'Monday-Friday') return new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
  if (days === 'Saturday-Sunday') return new Set(['Saturday', 'Sunday'])
  return new Set(days.split(',').map(d => d.trim()).filter(Boolean))
}

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function fromMinutes(total: number) {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function activeRules(rules: Row[]) {
  return rules.filter(rule => rule.active !== false)
}

function activeChannel(channels: Row[]) {
  return channels.find(c => c.status === 'Active' && c.type === 'Website') || channels.find(c => c.status === 'Active') || channels[0]
}

export function bookingSettings(channels: Row[], rules: Row[]) {
  const channel = activeChannel(channels)
  const rule = activeRules(rules)[0]
  return {
    channel,
    rule,
    leadTimeHours: Number(channel?.leadTimeHours ?? 2),
    horizonDays: Number(channel?.horizonDays ?? 60),
    slotMinutes: Number(rule?.slotMinutes ?? 30),
    maxConcurrent: Number(rule?.maxConcurrent ?? 1),
    opens: String(rule?.opens ?? '08:00'),
    closes: String(rule?.closes ?? '17:00'),
    days: String(rule?.days ?? 'Monday-Friday'),
    bufferMinutes: Number(rule?.bufferMinutes ?? 0)
  }
}

export function isDateBookable(date: string, channels: Row[], rules: Row[], now = new Date()) {
  const settings = bookingSettings(channels, rules)
  if (!settings.rule) return { ok: false as const, error: 'This shop has not configured booking availability yet.' }
  const today = now.toISOString().slice(0, 10)
  if (date < today) return { ok: false as const, error: 'Choose a current or future date.' }
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + settings.horizonDays)
  if (date > horizon.toISOString().slice(0, 10)) return { ok: false as const, error: `Bookings are limited to the next ${settings.horizonDays} days.` }
  const weekday = dayNames[new Date(`${date}T12:00:00`).getDay()]
  if (!parseDaySet(settings.days).has(weekday)) return { ok: false as const, error: 'The shop is closed on this day.' }
  return { ok: true as const, settings }
}

export function generateTimeSlots(date: string, channels: Row[], rules: Row[], appointments: Row[], now = new Date()) {
  const check = isDateBookable(date, channels, rules, now)
  if (!check.ok) return { slots: [] as string[], error: check.error }
  const { settings } = check
  const open = toMinutes(settings.opens)
  const close = toMinutes(settings.closes)
  const slots: string[] = []
  const leadCutoff = now.getTime() + settings.leadTimeHours * 3600000
  for (let minute = open; minute + settings.slotMinutes <= close; minute += settings.slotMinutes) {
    const time = fromMinutes(minute)
    const slotStart = new Date(`${date}T${time}:00`).getTime()
    if (slotStart < leadCutoff) continue
    const concurrent = appointments.filter(a => a.date === date && a.time === time && !['Cancelled', 'No show'].includes(String(a.status))).length
    if (concurrent < settings.maxConcurrent) slots.push(time)
  }
  return { slots, error: slots.length ? undefined : 'No open appointment times remain for this date.' }
}

export function validateBookingTime(date: string, time: string, channels: Row[], rules: Row[], appointments: Row[], now = new Date()) {
  const check = isDateBookable(date, channels, rules, now)
  if (!check.ok) return check
  const { slots, error } = generateTimeSlots(date, channels, rules, appointments, now)
  if (!slots.includes(time)) return { ok: false as const, error: error || 'That time is no longer available.' }
  return { ok: true as const }
}

export function orderTotal(order: Row) {
  const jobs = Array.isArray(order.jobs) ? order.jobs as Row[] : []
  const sub = jobs.filter(j => j.decision === 'Approved').reduce((sum, j) => sum + Number(j.laborHours || 0) * Number(j.laborRate || 0) + Number(j.partsPrice || 0), 0)
  return (sub + Number(order.fees || 0) - Number(order.discount || 0)) * (1 + Number(order.taxRate || 0) / 100)
}
