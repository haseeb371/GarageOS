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
      id: `CA-${shopId.slice(0, 8)}`,
      kind: 'callAgents',
      data: {
        id: `CA-${shopId.slice(0, 8)}`,
        name: `${shopName} booking agent`,
        status: 'Active',
        purpose: 'booking',
        greeting: `Thanks for calling ${shopName}. I'm the AutoGaragify voice assistant for the shop.`,
        salesPitch: '',
        bookingPrompt:
          'Tell me the vehicle, the service you need, and a preferred day. For example: oil change tomorrow morning for a 2019 Honda Civic.',
        goodbye: `Thanks for calling ${shopName}. Someone from the shop will follow up shortly. Goodbye.`,
        transferNumber: '',
        allowInbound: true,
        allowOutbound: true,
        language: 'en-US',
        notes: 'Shop booking line. Carrier carries PSTN; scripts are AutoGaragify.'
      }
    },
    {
      id: `CA-${shopId.slice(0, 8)}-sales`,
      kind: 'callAgents',
      data: {
        id: `CA-${shopId.slice(0, 8)}-sales`,
        name: 'AutoGaragify sales agent',
        status: 'Active',
        purpose: 'sales',
        greeting:
          'Hi, this is Alex from AutoGaragify. Thanks for taking my call — I will keep this under one minute.',
        salesPitch:
          'AutoGaragify is the shop operating system for independent garages. Online booking, digital inspections, repair orders, parts and inventory, invoices, SMS reminders, email, and automations — all in one place at autogaragify.com. Shops use it to stop juggling spreadsheets and expensive locked-in tools, so advisors spend more time with customers and less time on paperwork. You can run the whole front office from one login, including a built-in voice agent for booking and follow-ups.',
        bookingPrompt:
          'If a short live demo would help, press 1, or say a day this week that works. Press 2 if now is not a good time, and we will follow up by email.',
        goodbye:
          'Thanks for your time. Visit autogaragify.com anytime, or reply to our email and we will set up your shop. Have a great day.',
        transferNumber: '',
        allowInbound: true,
        allowOutbound: true,
        language: 'en-US',
        notes:
          'Trained to sell AutoGaragify. Captures demo interest and opens a lead ticket. Dial from Ops → Voice.'
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

export const defaultRecordKinds = ['bookingChannels', 'availabilityRules', 'capacityResources', 'workflowAutomations', 'callAgents', 'integrations'] as const
