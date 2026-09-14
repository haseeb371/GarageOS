import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema } from '@/lib/db'
import { dispatchAgentTool } from '@/lib/aiAgent/tools'
import { verifyWebhookSignature, verifyWebhookSignatureSimple } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureSchema()
  const rawBody = await req.text()
  const sig =
    req.headers.get('telnyx-signature-ed25519') || req.headers.get('Telnyx-Signature-Ed25519')
  const ts = req.headers.get('telnyx-timestamp') || req.headers.get('Telnyx-Timestamp')

  // Tools webhook: accept signed Telnyx traffic, or test secret, or unsigned in local when no public key.
  const hasKey = Boolean(process.env.TELNYX_PUBLIC_KEY?.trim() || process.env.TELNYX_WEBHOOK_TEST_SECRET)
  if (hasKey) {
    const verified =
      process.env.TELNYX_WEBHOOK_TEST_SECRET && sig === process.env.TELNYX_WEBHOOK_TEST_SECRET
        ? verifyWebhookSignatureSimple({
            rawBody,
            signature: sig,
            timestamp: ts || '0',
            testSecret: process.env.TELNYX_WEBHOOK_TEST_SECRET
          })
        : verifyWebhookSignature(rawBody, req.headers)
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error || 'Unauthorized' }, { status: 401 })
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = String(body.name || body.tool_name || body.function || '')
  const args = (body.arguments || body.parameters || body) as Record<string, unknown>
  const shopId = String(
    body.shop_id ||
      args.shop_id ||
      process.env.LEADS_IMPORT_SHOP_ID ||
      process.env.TELNYX_SHOP_ID ||
      'default'
  )
  const callControlId = String(body.call_control_id || args.call_control_id || '')

  const result = await dispatchAgentTool({
    name,
    args,
    shopId,
    callControlId
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
