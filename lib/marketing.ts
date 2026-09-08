type Row = Record<string, unknown> & { id: string }

export type DeclinedJob = Row & {
  name: string
  order: Row
  customerId: string
  customerName: string
  vehicleLabel: string
  value: number
}

export function jobValue(job: Row) {
  return Number(job.partsPrice || 0) + Number(job.laborHours || 0) * Number(job.laborRate || 0)
}

export function declinedWorkSegment(orders: Row[] = [], customers: Row[] = [], vehicles: Row[] = []) {
  const customerName = (id: string) => customers.find(c => c.id === id)?.name || id
  const vehicleLabel = (id: string) => {
    const v = vehicles.find(x => x.id === id)
    return v ? `${v.year} ${v.make} ${v.model}` : 'No vehicle'
  }
  return orders.flatMap(order =>
    (Array.isArray(order.jobs) ? order.jobs as Row[] : [])
      .filter(job => job.decision === 'Declined')
      .map(job => ({
        ...job,
        name: String(job.name || 'Declined service'),
        order,
        customerId: String(order.customerId || ''),
        customerName: customerName(String(order.customerId || '')),
        vehicleLabel: vehicleLabel(String(order.vehicleId || '')),
        value: jobValue(job)
      }))
  ) as DeclinedJob[]
}

export function buildDeclinedWorkCampaign(segment: DeclinedJob[]) {
  const audienceCustomerIds = [...new Set(segment.map(job => job.customerId).filter(Boolean))]
  const audienceJobIds = segment.map(job => `${job.order.id}:${job.id}`)
  const topJob = segment[0]
  const declinedValue = segment.reduce((sum, job) => sum + job.value, 0)
  const template = topJob
    ? `Hi {{customer}}, during your recent visit we recommended ${topJob.name}. When you're ready, reply or call us to schedule this service.`
    : 'A previously recommended service is ready when you are. Reply or call us to schedule.'
  return {
    id: `M-${Date.now().toString().slice(-6)}`,
    name: `Declined work recovery · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    channel: 'SMS sandbox',
    segment: 'Declined work',
    status: 'Draft',
    sent: 0,
    booked: 0,
    revenue: 0,
    template,
    audienceCustomerIds,
    audienceJobIds,
    declinedValue: Math.round(declinedValue * 100) / 100,
    audienceCount: audienceCustomerIds.length,
    createdAt: new Date().toISOString()
  }
}

export function isSmsOptedOut(customer?: Row | null) {
  if (!customer) return true
  return Boolean(customer.smsOptOut || customer.marketingOptOut)
}

export function isEmailOptedOut(customer?: Row | null) {
  if (!customer) return true
  return Boolean(customer.emailOptOut || customer.marketingOptOut)
}

export function campaignChannelKind(channel: string) {
  const value = String(channel || '').toLowerCase()
  if (value.includes('email')) return 'email' as const
  if (value.includes('sms') || value.includes('text')) return 'sms' as const
  return 'other' as const
}

export function resolveCampaignAudienceIds(campaign: Row, segment: DeclinedJob[]) {
  const ids = Array.isArray(campaign.audienceCustomerIds) ? (campaign.audienceCustomerIds as string[]) : []
  if (ids.length) return [...new Set(ids.filter(Boolean))]
  if (campaign.segment === 'Declined work') {
    return [...new Set(segment.map(job => job.customerId).filter(Boolean))]
  }
  return []
}

export function campaignAudienceCount(campaign: Row, segment: DeclinedJob[]) {
  return resolveCampaignAudienceIds(campaign, segment).length
}

export type AudiencePreviewRow = {
  customerId: string
  name: string
  phone: string
  email: string
  reachable: boolean
  skippedReason: string
}

export function campaignAudiencePreview(
  campaign: Row,
  customers: Row[] = [],
  segment: DeclinedJob[] = []
) {
  const kind = campaignChannelKind(String(campaign.channel || 'SMS sandbox'))
  const ids = resolveCampaignAudienceIds(campaign, segment)
  const rows: AudiencePreviewRow[] = ids.map(customerId => {
    const customer = customers.find(row => row.id === customerId)
    const name = String(customer?.name || customerId)
    const phone = String(customer?.phone || '')
    const email = String(customer?.email || '')
    if (!customer) {
      return { customerId, name, phone, email, reachable: false, skippedReason: 'Customer missing' }
    }
    if (kind === 'sms') {
      if (isSmsOptedOut(customer)) {
        return { customerId, name, phone, email, reachable: false, skippedReason: 'SMS opted out' }
      }
      if (!phone.trim()) {
        return { customerId, name, phone, email, reachable: false, skippedReason: 'No phone' }
      }
      return { customerId, name, phone, email, reachable: true, skippedReason: '' }
    }
    if (kind === 'email') {
      if (isEmailOptedOut(customer)) {
        return { customerId, name, phone, email, reachable: false, skippedReason: 'Email opted out' }
      }
      if (!email.trim()) {
        return { customerId, name, phone, email, reachable: false, skippedReason: 'No email' }
      }
      return { customerId, name, phone, email, reachable: true, skippedReason: '' }
    }
    return { customerId, name, phone, email, reachable: false, skippedReason: 'Channel not sendable' }
  })

  const reachable = rows.filter(row => row.reachable)
  const skipped = rows.filter(row => !row.reachable)
  return {
    kind,
    total: rows.length,
    reachable: reachable.length,
    skipped: skipped.length,
    rows,
    reachableIds: reachable.map(row => row.customerId)
  }
}

export function renderCampaignTemplate(template: string, customerName: string) {
  return String(template || '')
    .replaceAll('{{customer}}', customerName || 'there')
    .replaceAll('{customer}', customerName || 'there')
    .trim()
}

export function simulateCampaignSend(campaign: Row, segment: DeclinedJob[], sentCount?: number) {
  const audience = typeof sentCount === 'number' ? sentCount : campaignAudienceCount(campaign, segment)
  if (!audience) return { ...campaign, status: 'Draft' as const }
  return {
    ...campaign,
    status: 'Sent',
    sent: Number(campaign.sent || 0) + audience,
    lastSentAt: new Date().toISOString()
  }
}

export function markCampaignBooked(campaign: Row, segment: DeclinedJob[]) {
  const audience = campaignAudienceCount(campaign, segment)
  const booked = Math.min(audience, Number(campaign.booked || 0) + 1)
  const avgValue = segment.length ? segment.reduce((s, j) => s + j.value, 0) / segment.length : 0
  return {
    campaign: {
      ...campaign,
      status: booked >= audience ? 'Completed' : campaign.status,
      booked,
      revenue: Math.round((Number(campaign.revenue || 0) + avgValue) * 100) / 100
    },
    appointment: buildRecoveryAppointment(campaign, segment, booked - 1)
  }
}

export function buildRecoveryAppointment(campaign: Row, segment: DeclinedJob[], bookedIndex = 0) {
  const audienceIds = Array.isArray(campaign.audienceCustomerIds) ? campaign.audienceCustomerIds as string[] : []
  const customerId = audienceIds[bookedIndex] || segment[bookedIndex]?.customerId
  if (!customerId) return null
  const job = segment.find(item => item.customerId === customerId) || segment[bookedIndex]
  if (!job) return null
  const date = new Date(Date.now() + 3 * 86400000)
  return {
    id: `A-${Date.now().toString().slice(-6)}`,
    customerId,
    vehicleId: String(job.order.vehicleId || ''),
    date: date.toISOString().slice(0, 10),
    time: '09:00',
    service: String(job.name || 'Declined service follow-up'),
    status: 'Pending',
    source: 'Declined work campaign',
    campaignId: String(campaign.id),
    notes: `Booked from campaign ${campaign.name}`
  }
}
