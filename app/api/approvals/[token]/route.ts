import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getEstimateApproval, respondToEstimate } from '@/lib/approvals'

const responseInput = z.object({
  customerName: z.string().trim().min(2).max(100), consent: z.literal(true),
  decisions: z.array(z.object({ jobId: z.string().min(1), decision: z.enum(['Approved', 'Declined']) })).min(1).max(100)
})

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  return NextResponse.json(await getEstimateApproval(token), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const parsed = responseInput.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Complete every required field.' }, { status: 400 })
  try {
    const { token } = await context.params
    return NextResponse.json({ ok: true, ...(await respondToEstimate(token, parsed.data.decisions, parsed.data.customerName)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not submit your response.' }, { status: 400 })
  }
}
