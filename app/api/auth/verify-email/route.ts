import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, ensureSchema } from '@/lib/db'
import { authUsers } from '@/lib/schema'
import { createSession } from '@/lib/auth'
import { verifyCode, storeCode } from '@/lib/authCodes'
import { sendEmail } from '@/lib/email'
import { rateLimitByIp } from '@/lib/security'

const input = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(6).max(6)
})

export async function POST(req: Request) {
  await ensureSchema()
  const rl = await rateLimitByIp('verify-email', 10, 60_000)
  if (!rl.ok) return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 })

  const p = input.safeParse(await req.json())
  if (!p.success) return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 })

  const [u] = await db.select().from(authUsers).where(eq(authUsers.email, p.data.email)).limit(1)
  if (!u) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  if (u.emailVerified) return NextResponse.json({ error: 'Email is already verified. Sign in instead.' }, { status: 409 })

  const valid = await verifyCode(p.data.email, 'email-verification', p.data.code)
  if (!valid) return NextResponse.json({ error: 'Invalid or expired code. Click resend to get a new one.' }, { status: 400 })

  await db.update(authUsers).set({ emailVerified: true, updatedAt: Date.now() }).where(eq(authUsers.id, u.id))
  await createSession(u.id)
  return NextResponse.json({ ok: true })
}

export async function PUT(req: Request) {
  await ensureSchema()
  const rl = await rateLimitByIp('resend-code', 3, 60_000)
  if (!rl.ok) return NextResponse.json({ error: 'Too many resend attempts. Wait a minute.' }, { status: 429 })

  const { email } = await req.json().catch(() => ({ email: '' }))
  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })

  const [u] = await db.select().from(authUsers).where(eq(authUsers.email, String(email).toLowerCase())).limit(1)
  if (!u || u.emailVerified) return NextResponse.json({ error: 'No verification needed for this email.' }, { status: 404 })

  const code = await storeCode(u.email, 'email-verification')
  if (code) {
    await sendEmail({
      to: u.email,
      subject: 'AutoGaragify — verify your email',
      html: `<p>Your new verification code is:</p><h2 style="font-size:32px;letter-spacing:6px;color:#176448">${code}</h2><p>Enter this code to complete your account setup. It expires in 10 minutes.</p>`
    })
  }
  return NextResponse.json({ ok: true, message: 'New code sent to your email.' })
}
