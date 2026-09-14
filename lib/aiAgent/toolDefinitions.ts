export type AgentToolName =
  | 'mark_interested'
  | 'mark_not_interested'
  | 'mark_dnc'
  | 'transfer_to_human'
  | 'list_demo_slots'
  | 'book_demo'

export function assistantToolDefinitions(webhookBaseUrl: string) {
  const toolsUrl = `${webhookBaseUrl.replace(/\/$/, '')}/api/telnyx/tools`
  const tool = (
    name: AgentToolName,
    description: string,
    properties: Record<string, { type: string; description: string }>,
    required: string[]
  ) => ({
    type: 'webhook',
    webhook: {
      name,
      description,
      url: toolsUrl,
      method: 'POST',
      body_parameters: {
        type: 'object',
        properties,
        required
      }
    }
  })

  return [
    tool(
      'list_demo_slots',
      'List open 15-minute product demo times the buyer can book on the sales calendar',
      {
        lead_id: { type: 'string', description: 'Sales lead id if known' }
      },
      []
    ),
    tool(
      'book_demo',
      'Book a real 15-minute demo on the AutoGaragify sales calendar',
      {
        lead_id: { type: 'string', description: 'Sales lead id if known' },
        datetime_iso: {
          type: 'string',
          description: 'ISO datetime or starts_at ms from list_demo_slots'
        },
        contact_name: { type: 'string', description: 'Owner or manager name' },
        business_name: { type: 'string', description: 'Shop name' },
        phone: { type: 'string', description: 'Callback phone if different' },
        email: { type: 'string', description: 'Email for calendar confirmation' }
      },
      ['datetime_iso']
    ),
    tool(
      'mark_interested',
      'Lead wants a demo / is interested but no exact slot yet',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        preferred_time: { type: 'string', description: 'Preferred demo time window' }
      },
      []
    ),
    tool(
      'mark_not_interested',
      'Lead declined',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        reason: { type: 'string', description: 'Short reason' }
      },
      []
    ),
    tool(
      'mark_dnc',
      'Lead asked not to be called again',
      {
        lead_id: { type: 'string', description: 'Sales lead id' }
      },
      []
    ),
    tool(
      'transfer_to_human',
      'Warm transfer to sales human',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        call_control_id: { type: 'string', description: 'Active Telnyx call_control_id' }
      },
      ['call_control_id']
    )
  ]
}
