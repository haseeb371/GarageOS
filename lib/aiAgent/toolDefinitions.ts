export type AgentToolName =
  | 'mark_interested'
  | 'mark_not_interested'
  | 'mark_dnc'
  | 'transfer_to_human'
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
      'mark_interested',
      'Lead wants a demo / is interested',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        preferred_time: { type: 'string', description: 'Preferred demo time' }
      },
      ['lead_id']
    ),
    tool(
      'mark_not_interested',
      'Lead declined',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        reason: { type: 'string', description: 'Short reason' }
      },
      ['lead_id']
    ),
    tool(
      'mark_dnc',
      'Lead asked not to be called again',
      {
        lead_id: { type: 'string', description: 'Sales lead id' }
      },
      ['lead_id']
    ),
    tool(
      'transfer_to_human',
      'Warm transfer to sales human',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        call_control_id: { type: 'string', description: 'Active Telnyx call_control_id' }
      },
      ['lead_id', 'call_control_id']
    ),
    tool(
      'book_demo',
      'Book a 15-minute demo',
      {
        lead_id: { type: 'string', description: 'Sales lead id' },
        datetime_iso: { type: 'string', description: 'ISO datetime for demo' }
      },
      ['lead_id', 'datetime_iso']
    )
  ]
}
