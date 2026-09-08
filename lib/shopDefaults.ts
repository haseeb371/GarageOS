type DefaultRecord = { id: string; kind: string; data: Record<string, unknown> & { id: string } }

export function defaultShopRecords(shopId: string, shopName: string, now: number): DefaultRecord[] {
  const bookingChannelId = `BC-${shopId.slice(0, 8)}`
  return [
    {
      id: bookingChannelId,
      kind: 'bookingChannels',
      data: {
        id: bookingChannelId,
        name: `${shopName} booking page`,
        type: 'Website',
        status: 'Active',
        publicUrl: `/book/${shopId}`,
        calendarId: '',
        leadTimeHours: 2,
        horizonDays: 60,
        services: 'General service, diagnostics, maintenance, tires, brakes',
        notes: 'Public online booking for this location.'
      }
    },
    {
      id: `AV-${shopId.slice(0, 8)}`,
      kind: 'availabilityRules',
      data: {
        id: `AV-${shopId.slice(0, 8)}`,
        name: 'Weekday operations',
        days: 'Monday-Friday',
        opens: '08:00',
        closes: '17:00',
        slotMinutes: 30,
        maxConcurrent: 4,
        bufferMinutes: 15,
        active: true
      }
    },
    {
      id: `CAP-${shopId.slice(0, 8)}-1`,
      kind: 'capacityResources',
      data: {
        id: `CAP-${shopId.slice(0, 8)}-1`,
        name: 'Bay 1',
        type: 'General bay',
        capacityHours: 8,
        skills: 'General service, brakes, diagnostics',
        active: true
      }
    },
    {
      id: `CAP-${shopId.slice(0, 8)}-2`,
      kind: 'capacityResources',
      data: {
        id: `CAP-${shopId.slice(0, 8)}-2`,
        name: 'Bay 2',
        type: 'General bay',
        capacityHours: 8,
        skills: 'Maintenance, tires, alignments',
        active: true
      }
    },
    {
      id: `WF-${shopId.slice(0, 8)}-1`,
      kind: 'workflowAutomations',
      data: {
        id: `WF-${shopId.slice(0, 8)}-1`,
        name: 'Online booking confirmation',
        trigger: 'Appointment created',
        conditions: 'Source is online booking',
        action: 'Create confirmation task',
        delayMinutes: 0,
        status: 'Active',
        lastRunAt: '',
        runCount: 0,
        requiresApproval: false
      }
    },
    {
      id: `WF-${shopId.slice(0, 8)}-2`,
      kind: 'workflowAutomations',
      data: {
        id: `WF-${shopId.slice(0, 8)}-2`,
        name: 'Invoice on RO complete',
        trigger: 'Repair order completed',
        conditions: 'Always',
        action: 'Create invoice',
        delayMinutes: 0,
        status: 'Active',
        lastRunAt: '',
        runCount: 0,
        requiresApproval: false
      }
    },
    {
      id: `WF-${shopId.slice(0, 8)}-3`,
      kind: 'workflowAutomations',
      data: {
        id: `WF-${shopId.slice(0, 8)}-3`,
        name: 'Review after payment',
        trigger: 'Invoice paid',
        conditions: 'Status is Paid',
        action: 'Queue review request',
        delayMinutes: 0,
        status: 'Draft',
        lastRunAt: '',
        runCount: 0,
        requiresApproval: false
      }
    },
    {
      id: `WF-${shopId.slice(0, 8)}-4`,
      kind: 'workflowAutomations',
      data: {
        id: `WF-${shopId.slice(0, 8)}-4`,
        name: 'Low stock alert',
        trigger: 'Inventory low stock',
        conditions: 'Always',
        action: 'Create low-stock alert task',
        delayMinutes: 0,
        status: 'Active',
        lastRunAt: '',
        runCount: 0,
        requiresApproval: false
      }
    },
    {
      id: `WF-${shopId.slice(0, 8)}-5`,
      kind: 'workflowAutomations',
      data: {
        id: `WF-${shopId.slice(0, 8)}-5`,
        name: 'Declined work follow-up',
        trigger: 'Repair order has declined work',
        conditions: 'Always',
        action: 'Create declined work campaign',
        delayMinutes: 0,
        status: 'Draft',
        lastRunAt: '',
        runCount: 0,
        requiresApproval: false
      }
    },
    {
      id: `INT-SMS-${shopId.slice(0, 6)}`,
      kind: 'integrations',
      data: { id: `INT-SMS-${shopId.slice(0, 6)}`, name: 'Messaging (Twilio)', mode: 'Sandbox', status: 'Ready', regions: 'Global', notes: 'Connect credentials to send live SMS.' }
    },
    {
      id: `INT-PAY-${shopId.slice(0, 6)}`,
      kind: 'integrations',
      data: { id: `INT-PAY-${shopId.slice(0, 6)}`, name: 'Payments (Stripe)', mode: 'Sandbox', status: 'Ready', regions: 'Global', notes: 'Connect credentials for hosted card capture.' }
    },
    {
      id: `INT-ACC-${shopId.slice(0, 6)}`,
      kind: 'integrations',
      data: { id: `INT-ACC-${shopId.slice(0, 6)}`, name: 'Accounting sync', mode: 'CSV / webhook / QBO / Xero', status: 'Ready', regions: 'Global', notes: 'Sync invoices and payments, or download the journal CSV.' }
    },
    {
      id: `INT-PARTS-${shopId.slice(0, 6)}`,
      kind: 'integrations',
      data: { id: `INT-PARTS-${shopId.slice(0, 6)}`, name: 'PartsTech', mode: 'Sandbox', status: 'Not connected', regions: 'North America', notes: 'Supplier catalog and ordering.' }
    },
    {
      id: `INT-LABOR-${shopId.slice(0, 6)}`,
      kind: 'integrations',
      data: { id: `INT-LABOR-${shopId.slice(0, 6)}`, name: 'MOTOR labor guide', mode: 'Sandbox pack / CSV', status: 'Ready', regions: 'Global', notes: 'Use Labor & vehicle data → Load reference pack or Import CSV. Licensed MOTOR/AllData needs a provider contract.' }
    }
  ].map(entry => ({ ...entry, data: { ...entry.data, shopId, createdAt: now } }))
}

export const defaultRecordKinds = ['bookingChannels', 'availabilityRules', 'capacityResources', 'workflowAutomations', 'integrations'] as const
